import { type Object3D, Ray, Raycaster } from "three";

export function resolveRoomRayHit(
  ray: Ray,
  hitTargets: Iterable<Object3D>,
  occluders: Iterable<Object3D>,
): unknown {
  const candidates = [...hitTargets, ...occluders];
  if (candidates.length === 0) return null;

  const raycaster = new Raycaster(
    ray.origin.clone(),
    ray.direction.clone(),
    0,
    80,
  );
  const nearest = raycaster.intersectObjects(candidates, false)[0];
  if (!nearest || nearest.object.userData.roomOccluder === true) return null;

  return nearest.object.userData.roomObjectId ?? null;
}
