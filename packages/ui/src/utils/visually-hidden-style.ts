import type { CSSProperties } from 'react';

/** Inline-style equivalent of `<VisuallyHidden>`, for components (`Input`, `Select`) whose `label` must sometimes be present-but-not-shown without an extra wrapper element. */
export const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};
