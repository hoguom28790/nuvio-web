import morphdom from "../../../lib/morphdom.js";

export const MAX_DEPTH = 10;

export function applySectionScopedUpdate(container, nextMarkup, options = {}) {
  if (!container || typeof nextMarkup !== "string" || !container.children?.length) {
    return false;
  }
  try {
    const clone = container.cloneNode(false);
    clone.innerHTML = nextMarkup;
    
    morphdom(container, clone, {
      childrenOnly: true,
      onBeforeElUpdated: function(fromEl, toEl) {
        if (fromEl.isEqualNode(toEl)) {
          return false;
        }
        return true;
      }
    });
    return true;
  } catch (error) {
    console.error("Home morphdom update failed; rewriting", error);
    return false;
  }
}
