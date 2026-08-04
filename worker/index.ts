/** Cloudflare Worker entry point for Anish Shah’s public portfolio. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { refreshDiscogsWhenDue } from "../lib/server/connectors/discogs-scheduled";
import { pruneConnectorRetention } from "../lib/server/connectors/repository";
import { pruneSimulationRetention } from "../lib/server/simulation/repository";
import { pruneTravelRetention } from "../lib/server/travel";
import { authenticateRequest, isSitesRuntime } from "./access";
import { publicationAvailabilityResponse } from "./publication-fallback";
import {
  rateLimitSetupResponse,
  requiresConfiguredRateLimit,
  throttleArtwork,
  throttleDiscogsPublicRead,
  throttleOwnerWrite,
  throttlePromotionImport,
  throttleOAuthCallback,
  throttleSimulationApi,
  throttleTravelMedia,
} from "./rate-limiting";
import {
  beginRequestObservation,
  correlatedResponse,
  observeResponse,
  observeScheduledFailure,
} from "./redacted-observability";
import { productionOriginResponse } from "./production-origin";
import { canonicalSecurityPathname } from "./request-path";
import { hostedDeploymentBoundaryResponse } from "./deployment-boundary";
import { hostedDeploymentTier } from "../lib/deployment-environment";
import { boundedApiWrite } from "./request-limits";
import type {
  WorkerEnv,
  WorkerExecutionContext,
  WorkerScheduledController,
} from "./runtime-types";
import {
  nonceValue,
  securedResponse,
  withRequestSecurityHeaders,
} from "./security-headers";

async function routeApplicationRequest(
  request: Request,
  env: WorkerEnv,
  ctx: WorkerExecutionContext,
  pathname: string,
): Promise<Response> {
  if (pathname !== "/_vinext/image") {
    return handler.fetch(request, env, ctx);
  }

  const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
  return handleImageOptimization(
    request,
    {
      fetchAsset: (path) =>
        env.ASSETS.fetch(new Request(new URL(path, request.url))),
      transformImage: async (body, { width, format, quality }) => {
        const result = await env.IMAGES.input(body)
          .transform(width > 0 ? { width } : {})
          .output({ format, quality });
        return result.response();
      },
    },
    allowedWidths,
  );
}

const worker = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    ctx: WorkerExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const pathname = canonicalSecurityPathname(url.pathname);
    const development = env.NODE_ENV === "development";
    const sitesRuntime = isSitesRuntime(url.hostname);
    const directProduction = !development && !sitesRuntime;
    const deploymentTier = hostedDeploymentTier(env.DEPLOYMENT_TIER);
    const nonce = nonceValue();
    const observation = beginRequestObservation(
      request.method,
      pathname ?? "/invalid-path",
      env.RELEASE_SHA,
    );
    const finalize = (response: Response): Response => {
      const secured = correlatedResponse(
        securedResponse(
          response,
          request,
          nonce,
          development,
          pathname ?? "/invalid-path",
          deploymentTier,
          env.RELEASE_SHA,
        ),
        observation,
      );
      observeResponse(observation, secured);
      return secured;
    };
    try {
      if (pathname === null) {
        return finalize(
          new Response("Bad Request", {
            status: 400,
            headers: {
              "cache-control": "private, no-store",
              "content-type": "text/plain; charset=utf-8",
              "x-robots-tag": "noindex, nofollow, noarchive",
            },
          }),
        );
      }
      const originFailure = productionOriginResponse(request, env, {
        development,
        sitesRuntime,
      });
      if (originFailure) return finalize(originFailure);

      const authentication = await authenticateRequest(request, env, {
        pathname,
        directProduction,
        sitesRuntime,
        deploymentTier,
      });
      if (authentication.status === "denied") {
        return finalize(authentication.response);
      }

      const boundaryFailure = hostedDeploymentBoundaryResponse(
        request,
        deploymentTier,
      );
      if (boundaryFailure) return finalize(boundaryFailure);

      // Visual previews are Access-protected, read-only, and serve only
      // checked-in synthetic fixtures. They deliberately have no rate-limit
      // bindings or salt. The preview boundary above rejects every write,
      // Studio route, OAuth route, and promotion import before this point, so
      // applying hosted throttles here would make fixture pagination and
      // synthetic Travel media unavailable without improving protection.
      const enforceRequestRateLimits = deploymentTier !== "preview";

      if (
        enforceRequestRateLimits &&
        requiresConfiguredRateLimit(
          env,
          pathname,
          directProduction,
          authentication.accessMode,
        )
      ) {
        return finalize(rateLimitSetupResponse());
      }

      withRequestSecurityHeaders(
        authentication.headers,
        nonce,
        development,
        deploymentTier,
      );
      let appRequest = new Request(request, {
        headers: authentication.headers,
      });

      const discogsReadLimited = enforceRequestRateLimits
        ? await throttleDiscogsPublicRead(
            env,
            appRequest,
            development,
            pathname,
          )
        : null;
      if (discogsReadLimited && (directProduction || development)) {
        return finalize(discogsReadLimited);
      }

      const unavailable = await publicationAvailabilityResponse(
        appRequest,
        env,
        directProduction,
        pathname,
      );
      if (unavailable) return finalize(unavailable);

      const oauthCallbackLimited = enforceRequestRateLimits
        ? await throttleOAuthCallback(
            env,
            appRequest,
            development,
            pathname,
          )
        : null;
      if (oauthCallbackLimited && (directProduction || development)) {
        return finalize(oauthCallbackLimited);
      }

      const promotionLimited = enforceRequestRateLimits
        ? await throttlePromotionImport(
            env,
            appRequest,
            development,
            pathname,
          )
        : null;
      if (promotionLimited && (directProduction || development)) {
        return finalize(promotionLimited);
      }

      const simulationLimited = enforceRequestRateLimits
        ? await throttleSimulationApi(
            env,
            appRequest,
            development,
            pathname,
          )
        : null;
      if (simulationLimited && (directProduction || development)) {
        return finalize(simulationLimited);
      }

      const bounded = await boundedApiWrite(appRequest, pathname);
      if (bounded instanceof Response) return finalize(bounded);
      appRequest = bounded;

      const ownerLimited = enforceRequestRateLimits
        ? await throttleOwnerWrite(
            env,
            appRequest,
            authentication.identity,
            development,
            pathname,
          )
        : null;
      if (ownerLimited && (directProduction || development)) {
        return finalize(ownerLimited);
      }

      const artworkLimited = enforceRequestRateLimits
        ? await throttleArtwork(
            env,
            appRequest,
            development,
            pathname,
          )
        : null;
      if (artworkLimited && (directProduction || development)) {
        return finalize(artworkLimited);
      }

      const travelMediaLimited = enforceRequestRateLimits
        ? await throttleTravelMedia(
            env,
            appRequest,
            development,
            pathname,
          )
        : null;
      if (travelMediaLimited && (directProduction || development)) {
        return finalize(travelMediaLimited);
      }

      return finalize(
        await routeApplicationRequest(appRequest, env, ctx, pathname),
      );
    } catch {
      return finalize(
        new Response("The service is temporarily unavailable.", {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "retry-after": "60",
            "x-robots-tag": "noindex, nofollow, noarchive",
          },
        }),
      );
    }
  },

  async scheduled(
    controller: WorkerScheduledController,
    env: WorkerEnv,
    ctx: WorkerExecutionContext,
  ): Promise<void> {
    if (!env.DB) return;
    const db = env.DB;
    ctx.waitUntil(
      (async () => {
        const scheduledAt = new Date(controller.scheduledTime);
        await pruneConnectorRetention(db, scheduledAt);
        await pruneSimulationRetention(db, scheduledAt);
        await pruneTravelRetention(db, scheduledAt);
        await refreshDiscogsWhenDue(db, scheduledAt);
      })().catch(() => observeScheduledFailure(env.RELEASE_SHA)),
    );
  },
};

export default worker;
