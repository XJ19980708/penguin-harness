/**
 * Wallpaper preferences, which follow the account: the image and its display settings are
 * cached in this browser (the pre-paint script paints from the cache) and written through
 * lib/account-sync, which carries an edit to the account and has this provider read the cache
 * again when the account's copy arrives. Image bytes are stored separately so a slider writes
 * only settings.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BACKGROUND_STORAGE_KEYS,
  DEFAULT_BACKGROUND_SETTINGS,
  backgroundLayerStyle,
  isBackgroundImage,
  readBackground,
} from "@prismshadow/penguin-ui/boot";
import type { BackgroundSettings } from "@prismshadow/penguin-ui/boot";
import { subscribeAccountApplied, writeCached } from "../lib/account-sync/cache";

// The keys, the vocabulary and the reader are the shared package's (`@prismshadow/penguin-ui/boot`):
// the pre-paint script reads the same store, so a reload paints the image from the first frame.
export {
  BACKGROUND_MODES,
  BACKGROUND_POSITIONS,
  isBackgroundImage,
} from "@prismshadow/penguin-ui/boot";
export type {
  BackgroundMode,
  BackgroundPosition,
  BackgroundSettings,
} from "@prismshadow/penguin-ui/boot";

export const BACKGROUND_IMAGE_KEY = BACKGROUND_STORAGE_KEYS.image;
export const BACKGROUND_SETTINGS_KEY = BACKGROUND_STORAGE_KEYS.settings;
// The pre-paint script paints a stored picture, never a bundled texture, so this key is only read
// after mount — but it lives in the shared store's vocabulary because the account syncs it.
export const BACKGROUND_PRESET_KEY = BACKGROUND_STORAGE_KEYS.preset;
export const BACKGROUND_PRESET_OPACITY_KEY = BACKGROUND_STORAGE_KEYS.presetOpacity;
/** A texture carries its own alpha, so it starts fainter than a picture's 80% default. */
export const BACKGROUND_PRESET_OPACITY_DEFAULT = 25;

/** The shared defaults, under the name this package's consumers already use. */
export const BACKGROUND_DEFAULT_SETTINGS = DEFAULT_BACKGROUND_SETTINGS;

/**
 * Bundled textures. Each is a 1600×900 webp with a deliberate alpha channel, so it composites
 * over the canvas instead of covering it; the light/dark pair follows the theme's mode. Only the
 * id is persisted — the URLs are resolved at render time, keeping localStorage free of image data.
 */
export const BACKGROUND_PRESET_IDS = ["yuanshan", "shanshui", "pamir", "sayram"] as const;
export type BackgroundPresetId = (typeof BACKGROUND_PRESET_IDS)[number];

const RELIEF_DIR = `${import.meta.env.BASE_URL}relief/`;
export const BACKGROUND_PRESETS: Record<BackgroundPresetId, { light: string; dark: string }> = {
  yuanshan: { light: `${RELIEF_DIR}yuanshan-light.webp`, dark: `${RELIEF_DIR}yuanshan-dark.webp` },
  shanshui: { light: `${RELIEF_DIR}shanshui-light.webp`, dark: `${RELIEF_DIR}shanshui-dark.webp` },
  pamir: { light: `${RELIEF_DIR}pamir-light.webp`, dark: `${RELIEF_DIR}pamir-dark.webp` },
  sayram: { light: `${RELIEF_DIR}sayram-light.webp`, dark: `${RELIEF_DIR}sayram-dark.webp` },
};

/** The texture's URL for the active mode. */
export function presetImage(id: BackgroundPresetId, dark: boolean): string {
  const preset = BACKGROUND_PRESETS[id];
  return dark ? preset.dark : preset.light;
}

export function backgroundStyle(image: string | null, settings: BackgroundSettings): CSSProperties {
  return backgroundLayerStyle(image, settings);
}

/**
 * The stored background: the shared reader's picture and settings, plus the texture the web layer
 * draws as a layer of its own. Picture and texture are independent, so both may be present.
 */
function storedBackground(): {
  image: string | null;
  preset: BackgroundPresetId | null;
  presetOpacity: number;
  settings: BackgroundSettings;
} {
  const read = (storage: Pick<Storage, "getItem">) => {
    const stored = readBackground(storage);
    const preset =
      BACKGROUND_PRESET_IDS.find((id) => id === storage.getItem(BACKGROUND_PRESET_KEY)) ?? null;
    return {
      image: stored.image,
      preset,
      presetOpacity: readPresetOpacity(storage),
      settings: stored.settings,
    };
  };
  try {
    return read(localStorage);
  } catch {
    return read({ getItem: () => null });
  }
}

/** A stored 0–100 figure, or the texture's default when the key is absent or damaged. */
function readPresetOpacity(storage: Pick<Storage, "getItem">): number {
  const raw = storage.getItem(BACKGROUND_PRESET_OPACITY_KEY);
  if (raw === null) return BACKGROUND_PRESET_OPACITY_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return BACKGROUND_PRESET_OPACITY_DEFAULT;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

interface BackgroundContextValue {
  image: string | null;
  preset: BackgroundPresetId | null;
  /** The texture layer's transparency, independent of the picture's. */
  presetOpacity: number;
  settings: BackgroundSettings;
  setImage: (image: string | null) => void;
  setPreset: (preset: BackgroundPresetId | null) => void;
  setPresetOpacity: (opacity: number) => void;
  setSettings: (settings: BackgroundSettings) => void;
}
const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function BackgroundProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(storedBackground);
  const [image, setImageState] = useState(initial.image);
  const [preset, setPresetState] = useState(initial.preset);
  const [presetOpacity, setPresetOpacityState] = useState(initial.presetOpacity);
  const [settings, setSettingsState] = useState(initial.settings);

  // The account's background replaced the cached one at sign-in.
  useEffect(
    () =>
      subscribeAccountApplied(() => {
        const next = storedBackground();
        setImageState(next.image);
        setPresetState(next.preset);
        setPresetOpacityState(next.presetOpacity);
        setSettingsState(next.settings);
      }),
    [],
  );

  return (
    <BackgroundContext.Provider
      value={{
        image,
        preset,
        presetOpacity,
        settings,
        setImage: (next) => {
          if (next !== null && !isBackgroundImage(next)) {
            throw new Error("Invalid background image");
          }
          writeCached(BACKGROUND_IMAGE_KEY, next);
          // A failed write leaves the current picture untouched; the texture layer is independent.
          setImageState(next);
        },
        setPreset: (next) => {
          writeCached(BACKGROUND_PRESET_KEY, next);
          setPresetState(next);
        },
        setPresetOpacity: (next) => {
          const clamped = Math.min(100, Math.max(0, Math.round(next)));
          writeCached(BACKGROUND_PRESET_OPACITY_KEY, String(clamped));
          setPresetOpacityState(clamped);
        },
        setSettings: (next) => {
          writeCached(BACKGROUND_SETTINGS_KEY, JSON.stringify(next));
          setSettingsState(next);
        },
      }}
    >
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground(): BackgroundContextValue {
  const context = useContext(BackgroundContext);
  if (!context) throw new Error("useBackground must be used within a BackgroundProvider");
  return context;
}
