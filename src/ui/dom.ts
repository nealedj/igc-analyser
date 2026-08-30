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

export const clear = (n: Element): void => {
  while (n.firstChild) n.removeChild(n.firstChild);
};
