/** Cloudflare Worker entry point for Anish Shah’s public portfolio. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { pruneConnectorRetention } from "../lib/server/connectors/repository";
import { authenticateRequest, isSitesRuntime } from "./access";
import { publicationAvailabilityResponse } from "./publication-fallback";
import {
  rateLimitSetupResponse,
  requiresConfiguredRateLimit,
  throttleArtwork,
  throttleOwnerWrite,
  throttlePromotionImport,
  throttleOAuthCallback,
} from "./rate-limiting";
import {
  beginRequestObservation,
  correlatedResponse,
  observeResponse,
  observeScheduledFailure,
} from "./redacted-observability";
import { productionOriginResponse } from "./production-origin";
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
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/_vinext/image") {
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
    const development = env.NODE_ENV === "development";
    const sitesRuntime = isSitesRuntime(url.hostname);
    const directProduction = !development && !sitesRuntime;
    const nonce = nonceValue();
    const observation = beginRequestObservation(
      request.method,
      url.pathname,
      env.RELEASE_SHA,
    );
    const finalize = (response: Response): Response => {
      const secured = correlatedResponse(
        securedResponse(response, request, nonce, development),
        observation,
      );
      observeResponse(observation, secured);
      return secured;
    };
    try {
      const originFailure = productionOriginResponse(request, env, {
        development,
        sitesRuntime,
      });
      if (originFailure) return finalize(originFailure);

      const authentication = await authenticateRequest(request, env, {
        pathname: url.pathname,
        directProduction,
        sitesRuntime,
      });
      if (authentication.status === "denied") {
        return finalize(authentication.response);
      }

      if (
        requiresConfiguredRateLimit(
          env,
          url.pathname,
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
      );
      let appRequest = new Request(request, {
        headers: authentication.headers,
      });

      const unavailable = await publicationAvailabilityResponse(
        appRequest,
        env,
        directProduction,
      );
      if (unavailable) return finalize(unavailable);

      const oauthCallbackLimited = await throttleOAuthCallback(
        env,
        appRequest,
        development,
      );
      if (oauthCallbackLimited && (directProduction || development)) {
        return finalize(oauthCallbackLimited);
      }

      const promotionLimited = await throttlePromotionImport(
        env,
        appRequest,
        development,
      );
      if (promotionLimited && (directProduction || development)) {
        return finalize(promotionLimited);
      }

      const bounded = await boundedApiWrite(appRequest, url.pathname);
      if (bounded instanceof Response) return finalize(bounded);
      appRequest = bounded;

      const ownerLimited = await throttleOwnerWrite(
        env,
        appRequest,
        authentication.identity,
        development,
      );
      if (ownerLimited && (directProduction || development)) {
        return finalize(ownerLimited);
      }

      const artworkLimited = await throttleArtwork(
        env,
        appRequest,
        development,
      );
      if (artworkLimited && (directProduction || development)) {
        return finalize(artworkLimited);
      }

      return finalize(await routeApplicationRequest(appRequest, env, ctx));
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
    ctx.waitUntil(
      pruneConnectorRetention(env.DB, new Date(controller.scheduledTime)).catch(
        () => observeScheduledFailure(env.RELEASE_SHA),
      ),
    );
  },
};

export default worker;
