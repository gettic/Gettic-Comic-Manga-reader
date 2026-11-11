// Tiny DOM helper: el("div.class1.class2", { attrs }, children).

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

type TagOf<S extends string> = S extends `${infer T}.${string}` ? T : S;
type ElOf<S extends string> = TagOf<S> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagOf<S>] : HTMLElement;

export function el<S extends string>(tagAndClasses: S, attrs: Attrs = {}, ...children: Child[]): ElOf<S> {
  const [tag, ...classes] = tagAndClasses.split(".");
  const node = document.createElement(tag) as ElOf<S>;
  if (classes.length) node.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") node.addEventListener(k.replace(/^on/, ""), v as EventListener);
    else if (k === "html") node.innerHTML = String(v);
    else if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** An element holding trusted, built-in SVG markup (icons). */
export function svg(markup: string, cls = "icon"): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.innerHTML = markup;
  return s;
}
