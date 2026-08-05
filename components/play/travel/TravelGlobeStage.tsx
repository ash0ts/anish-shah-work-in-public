"use client";

import { Instance, Instances } from "@react-three/drei";
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  Group,
  MathUtils,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  TextureLoader,
  UnsignedByteType,
  Vector3,
} from "three";
import {
  Component,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TravelAtlasSnapshot } from "@/types/travel";
import {
  clampTravelGlobeTilt,
  countryTexturePixel,
  latLngToVector3,
  resolveTravelGlobeGesture,
  travelRegionTripCounts,
  vector3ToLatLng,
} from "./travel-globe-math";
import type {
  TravelAdmin1Manifest,
  TravelGeographyManifest,
} from "./travel-geography";
import styles from "./TravelGlobe.module.css";

const OCEAN = new Color("#252b45");
const UNVISITED = new Color("#56617f");
const ONE_TRIP = new Color("#45d7b1");
const TWO_TRIPS = new Color("#f6c85e");
const THREE_PLUS_TRIPS = new Color("#ff6847");
const SELECTED_REGION = new Color("#347cff");
const PIN_HIT_RADIUS = 0.1;
const PIN_VISUAL_RADIUS = 0.035;
const PIN_VISUAL_SCALE = PIN_VISUAL_RADIUS / PIN_HIT_RADIUS;
const PIN = new MeshBasicMaterial({ color: "#fff8eb" });
PIN.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `vec3 transformed = vec3(position * ${PIN_VISUAL_SCALE.toFixed(2)});`,
  );
};
PIN.customProgramCacheKey = () => "travel-pin-hit-0.1-visual-0.035-v2";

type CountrySampler = {
  image: ImageData;
  width: number;
  height: number;
};

type GlobePointerState = {
  pointerId: number;
  origin: readonly [number, number];
  previous: readonly [number, number];
  dragged: boolean;
  velocity: readonly [number, number];
};

function countColor(count: number): Color {
  if (count >= 3) return THREE_PLUS_TRIPS;
  if (count === 2) return TWO_TRIPS;
  if (count === 1) return ONE_TRIP;
  return UNVISITED;
}

function buildCountryLookupTexture(
  atlas: TravelAtlasSnapshot,
  geography: TravelGeographyManifest,
): DataTexture {
  const counts = new Map(atlas.countries.map((country) => [country.code, country.tripCount]));
  const bytes = new Uint8Array(256 * 4);
  for (let index = 0; index < 256; index += 1) {
    const color = index === 0 ? OCEAN : UNVISITED;
    bytes[index * 4] = Math.round(color.r * 255);
    bytes[index * 4 + 1] = Math.round(color.g * 255);
    bytes[index * 4 + 2] = Math.round(color.b * 255);
    bytes[index * 4 + 3] = 255;
  }
  for (const country of geography.countries) {
    const color = countColor(counts.get(country.code) ?? 0);
    bytes[country.id * 4] = Math.round(color.r * 255);
    bytes[country.id * 4 + 1] = Math.round(color.g * 255);
    bytes[country.id * 4 + 2] = Math.round(color.b * 255);
  }
  const texture = new DataTexture(bytes, 256, 1, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function buildPlanetMaterial(
  idMap: Texture,
  lookup: DataTexture,
  width: number,
  height: number,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      idMap: { value: idMap },
      lookup: { value: lookup },
      idTexel: { value: [1 / width, 1 / height] },
      lightDirection: { value: new Vector3(0.4, 0.75, 0.8).normalize() },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D idMap;
      uniform sampler2D lookup;
      uniform vec2 idTexel;
      uniform vec3 lightDirection;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rawId = texture2D(idMap, vUv).r;
        float countryId = floor(rawId * 255.0 + 0.5);
        vec3 base = texture2D(lookup, vec2((countryId + 0.5) / 256.0, 0.5)).rgb;
        float neighborDelta = max(
          max(
            abs(rawId - texture2D(idMap, vUv + vec2(idTexel.x, 0.0)).r),
            abs(rawId - texture2D(idMap, vUv - vec2(idTexel.x, 0.0)).r)
          ),
          max(
            abs(rawId - texture2D(idMap, vUv + vec2(0.0, idTexel.y)).r),
            abs(rawId - texture2D(idMap, vUv - vec2(0.0, idTexel.y)).r)
          )
        );
        float countryEdge = step(0.5 / 255.0, neighborDelta);
        float diffuse = dot(normalize(vNormal), normalize(lightDirection));
        float band = diffuse > 0.56 ? 1.0 : (diffuse > 0.08 ? 0.78 : 0.56);
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.4);
        vec3 edge = vec3(0.78, 0.72, 1.0) * fresnel * 0.34;
        vec3 shaded = base * band + edge;
        vec3 borderInk = vec3(0.035, 0.067, 0.122);
        gl_FragColor = vec4(mix(shaded, borderInk, countryEdge * 0.82), 1.0);
      }
    `,
  });
}

function useCountryTexture(
  atlas: TravelAtlasSnapshot,
  geography: TravelGeographyManifest,
  onFailure: () => void,
) {
  const [loaded, setLoaded] = useState<{
    texture: Texture;
    sampler: CountrySampler;
  } | null>(null);
  const { invalidate } = useThree();

  useEffect(() => {
    let active = true;
    const loader = new TextureLoader();
    loader.load(
      geography.idTexture.src,
      (texture) => {
        if (!active) {
          texture.dispose();
          return;
        }
        try {
          const image = texture.image as CanvasImageSource;
          const canvas = document.createElement("canvas");
          canvas.width = geography.idTexture.width;
          canvas.height = geography.idTexture.height;
          const context = canvas.getContext("2d", {
            alpha: false,
            willReadFrequently: true,
          });
          if (!context) throw new Error("Travel map decode unavailable.");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          texture.magFilter = NearestFilter;
          texture.minFilter = NearestFilter;
          texture.colorSpace = NoColorSpace;
          texture.generateMipmaps = false;
          texture.needsUpdate = true;
          setLoaded({
            texture,
            sampler: {
              image: context.getImageData(0, 0, canvas.width, canvas.height),
              width: canvas.width,
              height: canvas.height,
            },
          });
          invalidate();
        } catch {
          texture.dispose();
          onFailure();
        }
      },
      undefined,
      () => {
        if (active) onFailure();
      },
    );
    return () => {
      active = false;
    };
  }, [geography, invalidate, onFailure]);

  const lookup = useMemo(
    () => buildCountryLookupTexture(atlas, geography),
    [atlas, geography],
  );
  useEffect(() => () => lookup.dispose(), [lookup]);

  const material = useMemo(
    () =>
      loaded
        ? buildPlanetMaterial(
            loaded.texture,
            lookup,
            geography.idTexture.width,
            geography.idTexture.height,
          )
        : null,
    [geography.idTexture.height, geography.idTexture.width, loaded, lookup],
  );
  useEffect(
    () => () => {
      material?.dispose();
      loaded?.texture.dispose();
    },
    [loaded, material],
  );

  return { material, sampler: loaded?.sampler ?? null };
}

function resolveCountryCode(
  sampler: CountrySampler,
  geography: TravelGeographyManifest,
  point: Vector3,
): string | null {
  const { lat, lng } = vector3ToLatLng(point);
  const [x, y] = countryTexturePixel(
    lat,
    lng,
    sampler.width,
    sampler.height,
  );
  const index = (y * sampler.width + x) * 4;
  const id = sampler.image.data[index] ?? 0;
  return geography.countries.find((country) => country.id === id)?.code ?? null;
}

type BoundaryLayer = {
  key: string;
  color: Color;
  geometry: BufferGeometry;
};

function boundaryLayers(
  admin1: TravelAdmin1Manifest | null,
  atlas: TravelAtlasSnapshot,
  selectedRegionCode: string | null,
): BoundaryLayer[] {
  const tripCounts = travelRegionTripCounts(
    atlas.trips,
    admin1?.countryCode ?? "",
  );
  const pointsByLayer = new Map<string, Vector3[]>();
  for (const region of admin1?.regions ?? []) {
    const count = tripCounts.get(region.code) ?? 0;
    const key =
      region.code === selectedRegionCode
        ? "selected"
        : count >= 3
          ? "3+"
          : String(count);
    const points = pointsByLayer.get(key) ?? [];
    for (const ring of region.rings) {
      for (let index = 1; index < ring.length; index += 1) {
        const previous = ring[index - 1];
        const current = ring[index];
        points.push(
          latLngToVector3(previous[0], previous[1], 1.012),
          latLngToVector3(current[0], current[1], 1.012),
        );
      }
    }
    pointsByLayer.set(key, points);
  }
  const colors = new Map<string, Color>([
    ["0", UNVISITED],
    ["1", ONE_TRIP],
    ["2", TWO_TRIPS],
    ["3+", THREE_PLUS_TRIPS],
    ["selected", SELECTED_REGION],
  ]);
  return [...pointsByLayer.entries()]
    .filter(([, points]) => points.length > 0)
    .map(([key, points]) => ({
      key,
      color: colors.get(key) ?? UNVISITED,
      geometry: new BufferGeometry().setFromPoints(points),
    }));
}

function CameraZoomRig({ zoom }: { zoom: number }) {
  const { camera, invalidate } = useThree();

  useEffect(() => invalidate(), [invalidate, zoom]);
  useFrame((_, rawDelta) => {
    const destination = MathUtils.lerp(4.4, 2.75, zoom);
    const next = MathUtils.damp(camera.position.z, destination, 10, Math.min(rawDelta, 0.05));
    camera.position.setZ(next);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    if (Math.abs(next - destination) > 0.001) invalidate();
  });
  return null;
}

function ContextLossMonitor({ onContextLoss }: { onContextLoss: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const handle = (event: Event) => {
      event.preventDefault();
      onContextLoss();
    };
    gl.domElement.addEventListener("webglcontextlost", handle, { once: true });
    return () => gl.domElement.removeEventListener("webglcontextlost", handle);
  }, [gl, onContextLoss]);
  return null;
}

function Planet({
  admin1,
  atlas,
  geography,
  onReady,
  onTextureFailure,
  onHoverPlace,
  onSelectCountry,
  onSelectPlace,
  pinching,
  reducedMotion,
  selectedCountryCode,
  selectedPlaceId,
  selectedRegionCode,
  zoom,
}: {
  admin1: TravelAdmin1Manifest | null;
  atlas: TravelAtlasSnapshot;
  geography: TravelGeographyManifest;
  onReady: () => void;
  onTextureFailure: () => void;
  onHoverPlace: (placeId: string | null) => void;
  onSelectCountry: (code: string) => void;
  onSelectPlace: (placeId: string) => void;
  pinching: MutableRefObject<boolean>;
  reducedMotion: boolean;
  selectedCountryCode: string | null;
  selectedPlaceId: string | null;
  selectedRegionCode: string | null;
  zoom: number;
}) {
  const globe = useRef<Group>(null);
  const pointer = useRef<GlobePointerState | null>(null);
  const hoveredPlaceId = useRef<string | null>(null);
  const pressedPlaceId = useRef<string | null>(null);
  const target = useRef({ x: 0.13, y: -0.35 });
  const inertia = useRef({ x: 0, y: 0 });
  const suppressSelectionUntil = useRef(0);
  const readyFrames = useRef(0);
  const { gl, invalidate } = useThree();
  const { material, sampler } = useCountryTexture(
    atlas,
    geography,
    onTextureFailure,
  );
  const places = useMemo(
    () => atlas.trips.flatMap((trip) => trip.places),
    [atlas.trips],
  );
  const selectedPlace = places.find(({ id }) => id === selectedPlaceId) ?? null;
  const selectedCountry = geography.countries.find(
    ({ code }) => code === selectedCountryCode,
  );
  const selectedRegion = admin1?.regions.find(
    ({ code }) => code === selectedRegionCode,
  );
  const boundaries = useMemo(
    () => boundaryLayers(admin1, atlas, selectedRegionCode),
    [admin1, atlas, selectedRegionCode],
  );
  useEffect(
    () => () => {
      for (const layer of boundaries) layer.geometry.dispose();
    },
    [boundaries],
  );

  const clearSelectionSuppression = useCallback(() => {
    suppressSelectionUntil.current = 0;
  }, []);

  const suppressSelectionThroughClick = useCallback(() => {
    // A drag may or may not be followed by a browser click event. Bound the
    // guard in wall-clock time so a missing click cannot poison a later,
    // intentional selection.
    suppressSelectionUntil.current = performance.now() + 250;
  }, []);

  const consumeSelectionSuppression = useCallback(() => {
    const shouldSuppress = performance.now() <= suppressSelectionUntil.current;
    suppressSelectionUntil.current = 0;
    return shouldSuppress;
  }, []);

  const cancelGesture = useCallback(() => {
    if (!pointer.current) return;
    suppressSelectionThroughClick();
    pointer.current = null;
    pressedPlaceId.current = null;
    inertia.current = { x: 0, y: 0 };
    invalidate();
  }, [invalidate, suppressSelectionThroughClick]);

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLostCapture = () => cancelGesture();
    const handleVisibility = () => {
      if (document.hidden) cancelGesture();
    };
    canvas.addEventListener("lostpointercapture", handleLostCapture);
    canvas.addEventListener("pointercancel", handleLostCapture);
    window.addEventListener("blur", handleLostCapture);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      canvas.removeEventListener("lostpointercapture", handleLostCapture);
      canvas.removeEventListener("pointercancel", handleLostCapture);
      window.removeEventListener("blur", handleLostCapture);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearSelectionSuppression();
    };
  }, [cancelGesture, clearSelectionSuppression, gl]);

  useEffect(() => {
    const point = selectedPlace?.publicPoint;
    const center = point
      ? ([point.lat, point.lng] as const)
      : (selectedRegion?.centroid ?? selectedCountry?.centroid);
    if (!center) {
      target.current = { x: 0.13, y: -0.35 };
      inertia.current = { x: 0, y: 0 };
      invalidate();
      return;
    }
    target.current = {
      x: clampTravelGlobeTilt(MathUtils.degToRad(center[0])),
      y: -MathUtils.degToRad(center[1]),
    };
    inertia.current = { x: 0, y: 0 };
    invalidate();
  }, [invalidate, selectedCountry, selectedPlace, selectedRegion]);

  useFrame((_, rawDelta) => {
    const object = globe.current;
    if (!object) return;
    const delta = Math.min(rawDelta, 0.05);
    if (!pointer.current && !reducedMotion) {
      target.current.x = clampTravelGlobeTilt(target.current.x + inertia.current.x * delta);
      target.current.y += inertia.current.y * delta;
      inertia.current.x = MathUtils.damp(inertia.current.x, 0, 8, delta);
      inertia.current.y = MathUtils.damp(inertia.current.y, 0, 8, delta);
    }
    const damping = reducedMotion ? 1000 : 12;
    object.rotation.x = MathUtils.damp(object.rotation.x, target.current.x, damping, delta);
    object.rotation.y = MathUtils.damp(object.rotation.y, target.current.y, damping, delta);
    const moving =
      Math.abs(object.rotation.x - target.current.x) > 0.001 ||
      Math.abs(object.rotation.y - target.current.y) > 0.001 ||
      Math.abs(inertia.current.x) > 0.004 ||
      Math.abs(inertia.current.y) > 0.004;
    if (moving) invalidate();
    if (material && sampler && readyFrames.current < 2) {
      readyFrames.current += 1;
      invalidate();
      if (readyFrames.current === 2) queueMicrotask(onReady);
    }
  });

  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    if (pointer.current) return;
    clearSelectionSuppression();
    pointer.current = {
      pointerId: event.pointerId,
      origin: [event.clientX, event.clientY],
      previous: [event.clientX, event.clientY],
      dragged: false,
      velocity: [0, 0],
    };
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const drag = (event: ThreeEvent<PointerEvent>) => {
    if (pinching.current) {
      cancelGesture();
      return;
    }
    const current = pointer.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const now = [event.clientX, event.clientY] as const;
    const gesture = resolveTravelGlobeGesture(
      current.dragged,
      current.origin,
      now,
    );
    const dragged = gesture.dragged;
    const dx = now[0] - current.previous[0];
    const dy = now[1] - current.previous[1];
    pointer.current = {
      ...current,
      previous: now,
      dragged,
      velocity: [dy * 0.012, dx * 0.012],
    };
    if (!dragged) return;
    target.current.x = clampTravelGlobeTilt(target.current.x + dy * 0.005);
    target.current.y += dx * 0.005;
    inertia.current = { x: 0, y: 0 };
    if (gesture.suppressSelection) {
      suppressSelectionUntil.current = performance.now() + 250;
    }
    event.stopPropagation();
    invalidate();
  };

  const endDrag = (event: ThreeEvent<PointerEvent>) => {
    const current = pointer.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.dragged && !reducedMotion) {
      inertia.current = {
        x: current.velocity[0],
        y: current.velocity[1],
      };
      invalidate();
    }
    pointer.current = null;
    pressedPlaceId.current = null;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    if (current.dragged) suppressSelectionThroughClick();
  };

  const cancelDrag = (event: ThreeEvent<PointerEvent>) => {
    const current = pointer.current;
    if (!current || current.pointerId !== event.pointerId) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    pressedPlaceId.current = null;
    cancelGesture();
  };

  const selectCountry = (event: ThreeEvent<MouseEvent>) => {
    if (consumeSelectionSuppression()) return;
    if (!sampler || !globe.current) return;
    const localPoint = globe.current.worldToLocal(event.point.clone());
    const code = resolveCountryCode(sampler, geography, localPoint);
    if (code) onSelectCountry(code);
  };

  return (
    <>
      <CameraZoomRig zoom={zoom} />
      <ambientLight intensity={1.05} color="#fff8eb" />
      <directionalLight intensity={1.35} color="#f4efe7" position={[3, 4, 5]} />
      <group
        onPointerCancel={cancelDrag}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        ref={globe}
        rotation={[0.13, -0.35, 0]}
      >
        <mesh onClick={selectCountry}>
          <sphereGeometry args={[1, 72, 40]} />
          {material ? (
            <primitive attach="material" object={material} />
          ) : (
            <meshToonMaterial color="#4b448f" />
          )}
        </mesh>
        {boundaries.map((layer) => (
          <lineSegments geometry={layer.geometry} key={layer.key}>
            <lineBasicMaterial color={layer.color} opacity={0.9} transparent />
          </lineSegments>
        ))}
        <Instances limit={Math.max(places.length, 1)} range={places.length}>
          {/* Raycasting uses the larger geometry while the vertex shader keeps
              every visible pin at the established 0.035 radius. This improves
              default-scale selection without changing the map's visual encoding. */}
          <sphereGeometry args={[PIN_HIT_RADIUS, 8, 6]} />
          <primitive attach="material" object={PIN} />
          {places.map((place) => (
            <Instance
              key={place.id}
              onPointerDown={() => {
                pressedPlaceId.current = place.id;
              }}
              onPointerOut={(event) => {
                event.stopPropagation();
                hoveredPlaceId.current = null;
                onHoverPlace(null);
              }}
              onPointerOver={(event) => {
                event.stopPropagation();
                hoveredPlaceId.current = place.id;
                onHoverPlace(place.id);
              }}
              onPointerUp={() => {
                const current = pointer.current;
                // This handler only runs when the pointer-up ray intersects
                // this exact Instance. Pair that fresh intersection with the
                // recorded pointer-down identity instead of relying on the
                // asynchronous hover attribute, which can lag by a frame at
                // compact viewport scales.
                const shouldSelect =
                  current !== null &&
                  !current.dragged &&
                  pressedPlaceId.current === place.id;
                pressedPlaceId.current = null;
                if (shouldSelect) onSelectPlace(place.id);
              }}
              position={latLngToVector3(
                place.publicPoint.lat,
                place.publicPoint.lng,
                1.06,
              )}
              scale={place.id === selectedPlaceId ? 1.5 : 1}
            />
          ))}
        </Instances>
        {selectedPlace ? (
          <mesh
            position={latLngToVector3(
              selectedPlace.publicPoint.lat,
              selectedPlace.publicPoint.lng,
              1.065,
            )}
          >
            <ringGeometry args={[0.055, 0.078, 16]} />
            <meshBasicMaterial color="#347cff" side={DoubleSide} />
          </mesh>
        ) : null}
      </group>
    </>
  );
}

class TravelGlobeBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function TravelGlobeStage({
  admin1,
  atlas,
  geography,
  onContextLoss,
  onReady,
  onZoomChange,
  onSelectCountry,
  onSelectPlace,
  reducedMotion,
  selectedCountryCode,
  selectedPlaceId,
  selectedRegionCode,
  zoom,
}: {
  admin1: TravelAdmin1Manifest | null;
  atlas: TravelAtlasSnapshot;
  geography: TravelGeographyManifest;
  onContextLoss: () => void;
  onReady: () => void;
  onZoomChange: (zoom: number) => void;
  onSelectCountry: (code: string) => void;
  onSelectPlace: (placeId: string) => void;
  reducedMotion: boolean;
  selectedCountryCode: string | null;
  selectedPlaceId: string | null;
  selectedRegionCode: string | null;
  zoom: number;
}) {
  const touchPoints = useRef(new Map<number, readonly [number, number]>());
  const pinchDistance = useRef<number | null>(null);
  const pinchZoom = useRef(zoom);
  const pinching = useRef(false);
  const [hoveredPlaceId, setHoveredPlaceId] = useState<string | null>(null);

  useEffect(() => {
    pinchZoom.current = zoom;
  }, [zoom]);

  const rememberPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    touchPoints.current.set(event.pointerId, [event.clientX, event.clientY]);
    if (touchPoints.current.size === 2) {
      pinching.current = true;
      const [first, second] = [...touchPoints.current.values()];
      pinchDistance.current = Math.hypot(second[0] - first[0], second[1] - first[1]);
    }
  };

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || !touchPoints.current.has(event.pointerId)) return;
    touchPoints.current.set(event.pointerId, [event.clientX, event.clientY]);
    if (touchPoints.current.size !== 2) return;
    const [first, second] = [...touchPoints.current.values()];
    const distance = Math.hypot(second[0] - first[0], second[1] - first[1]);
    const prior = pinchDistance.current;
    pinchDistance.current = distance;
    if (!prior || Math.abs(distance - prior) < 1) return;
    const nextZoom = MathUtils.clamp(
      pinchZoom.current + (distance - prior) / 260,
      0,
      1,
    );
    pinchZoom.current = nextZoom;
    onZoomChange(nextZoom);
  };

  const forgetPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    touchPoints.current.delete(event.pointerId);
    if (touchPoints.current.size < 2) {
      pinchDistance.current = null;
      pinching.current = false;
    }
  };

  return (
    <TravelGlobeBoundary onFailure={onContextLoss}>
      <div
        aria-hidden="true"
        className={styles.canvas}
        data-travel-globe-canvas
        data-travel-globe-hovered-place={hoveredPlaceId ?? undefined}
        onPointerCancel={forgetPointer}
        onPointerDown={rememberPointer}
        onPointerLeave={() => setHoveredPlaceId(null)}
        onPointerMove={movePointer}
        onPointerUp={forgetPointer}
      >
        <Canvas
          aria-hidden="true"
          camera={{ far: 20, fov: 37, near: 0.1, position: [0, 0, 4.4] }}
          dpr={[1, 1.5]}
          frameloop="demand"
          gl={{
            alpha: false,
            antialias: false,
            depth: true,
            failIfMajorPerformanceCaveat: true,
            powerPreference: "low-power",
            stencil: false,
          }}
          onCreated={({ gl }) => {
            gl.domElement.setAttribute("aria-hidden", "true");
            gl.domElement.setAttribute("role", "presentation");
            gl.domElement.tabIndex = -1;
            gl.setClearColor("#08111f", 1);
          }}
          role="presentation"
          tabIndex={-1}
        >
          <ContextLossMonitor onContextLoss={onContextLoss} />
          <Planet
            admin1={admin1}
            atlas={atlas}
            geography={geography}
            onHoverPlace={setHoveredPlaceId}
            onReady={onReady}
            onTextureFailure={onContextLoss}
            onSelectCountry={onSelectCountry}
            onSelectPlace={onSelectPlace}
            pinching={pinching}
            reducedMotion={reducedMotion}
            selectedCountryCode={selectedCountryCode}
            selectedPlaceId={selectedPlaceId}
            selectedRegionCode={selectedRegionCode}
            zoom={zoom}
          />
        </Canvas>
      </div>
    </TravelGlobeBoundary>
  );
}
