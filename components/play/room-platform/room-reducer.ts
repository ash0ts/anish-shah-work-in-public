import type {
  RoomExperienceAction,
  RoomExperienceState,
  RoomRotation,
} from "./room-types";

export const INITIAL_ROOM_ROTATION: RoomRotation = { x: 0, y: 0 };

export const INITIAL_ROOM_STATE: RoomExperienceState = {
  entered: false,
  selectedId: null,
  focusedId: null,
  phase: "idle",
  transitionEpoch: 0,
  rotation: INITIAL_ROOM_ROTATION,
  fallbackReason: null,
};

function boundedRotation(rotation: RoomRotation): RoomRotation {
  return {
    x: Math.max(-7, Math.min(7, rotation.x)),
    y: Math.max(-12, Math.min(12, rotation.y)),
  };
}

export function roomExperienceReducer(
  state: RoomExperienceState,
  action: RoomExperienceAction,
): RoomExperienceState {
  if (action.type === "enter") {
    if (state.fallbackReason) return state;
    return { ...state, entered: true, phase: "idle" };
  }
  if (action.type === "focus") {
    if (state.focusedId === action.id) return state;
    return { ...state, focusedId: action.id };
  }
  if (action.type === "select") {
    return {
      ...state,
      entered: true,
      selectedId: action.id,
      focusedId: action.id,
      phase: "acknowledging",
      transitionEpoch: state.transitionEpoch + 1,
    };
  }
  if (action.type === "phase") {
    if (action.epoch !== state.transitionEpoch) return state;
    return { ...state, phase: action.phase };
  }
  if (action.type === "route") {
    return {
      ...state,
      selectedId: action.id,
      focusedId: action.id ?? state.focusedId,
      phase: action.id ? "presenting" : "idle",
    };
  }
  if (action.type === "return") {
    return {
      ...state,
      selectedId: null,
      phase: "returning",
      transitionEpoch: state.transitionEpoch + 1,
    };
  }
  if (action.type === "exit") {
    return {
      ...INITIAL_ROOM_STATE,
      focusedId: state.focusedId,
      fallbackReason: state.fallbackReason,
      transitionEpoch: state.transitionEpoch + 1,
    };
  }
  if (action.type === "rotate") {
    const rotation = boundedRotation(action.rotation);
    if (
      state.rotation.x === rotation.x &&
      state.rotation.y === rotation.y
    ) {
      return state;
    }
    return { ...state, rotation };
  }
  if (action.type === "reset-view") {
    if (state.rotation.x === 0 && state.rotation.y === 0) return state;
    return { ...state, rotation: INITIAL_ROOM_ROTATION };
  }
  return {
    ...state,
    entered: false,
    fallbackReason: action.reason,
    phase: "idle",
  };
}
