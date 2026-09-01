/** The smallest possible element helper. No framework, no reactivity. */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v);
    else if (v === false || v === null || v === undefined) continue;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) if (c || c === '') node.append(c as Node | string);
  return node;
}

/**
 * Empty an element in one step.
 *
 * Removing children one at a time is not safe here: taking away a node that
 * currently has focus fires blur, a blur on a text or number input fires
 * change, and a change handler re-renders - which empties the same element
 * again, from inside the loop that is already emptying it. `replaceChildren`
 * cannot be re-entered halfway through.
 */
export const clear = (n: Element): void => {
  n.replaceChildren();
};
