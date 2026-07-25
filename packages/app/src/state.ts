import type { AppSaveDocument } from "@psv-exporter/core/browser";

const ADVANCED_VIEW_STORAGE_KEY = "ps2-save-manager-advanced-view";

export const appState: { document?: AppSaveDocument; advancedView: boolean } = {
  advancedView: (() => {
    try { return window.localStorage.getItem(ADVANCED_VIEW_STORAGE_KEY) === "true"; }
    catch { return false; }
  })(),
};

export function setAdvancedView(enabled: boolean): void {
  appState.advancedView = enabled;
  try { window.localStorage.setItem(ADVANCED_VIEW_STORAGE_KEY, String(enabled)); } catch { /* storage can be unavailable */ }
}
