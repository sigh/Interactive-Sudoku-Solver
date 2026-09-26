// A minimal fake DOM for UI tests that run in Node. It records what the code
// builds (tree, attributes, classes, styles, listeners) and supports the few
// behaviours tests rely on, such as click() being ignored while disabled.

// Selectors are lists of compound selectors joined by ' ' or '>', e.g.
// 'input[type="checkbox"]' or ':scope > .chip-label > .chip-icon, .icon'.
// A compound selector is ':scope' (the element queried from), or a tag,
// classes and [attr="value"]s (with no spaces in the value).
const COMPOUND_RE = /^([a-zA-Z]*)((?:\.[\w-]+)*)((?:\[[\w-]+="[^"]*"\])*)$/;

const parseCompound = (compound) => {
  if (compound === ':scope') return { scope: true };
  const match = compound.match(COMPOUND_RE);
  if (!match) throw new Error(`Unsupported selector: ${compound}`);
  const [, tag, classes, attrs] = match;
  return {
    tag: tag.toUpperCase(),
    classes: classes.split('.').slice(1),
    attrs: [...attrs.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map(([, k, v]) => [k, v]),
  };
};

// A selector without commas, as parsed compound selectors and the
// combinators between them.
const parseComplex = (selector) => {
  const parts = [];
  for (const token of selector.trim().split(/\s*(>)\s*|\s+/)) {
    if (!token) continue;
    if (token !== '>' && parts.length && parts.at(-1) !== '>') parts.push(' ');
    parts.push(token === '>' ? token : parseCompound(token));
  }
  return parts;
};

// Each selector, parsed once.
const parsedSelectors = new Map();
const parseSelector = (selector) => {
  let parsed = parsedSelectors.get(selector);
  if (!parsed) {
    parsed = selector.split(',').map(parseComplex);
    parsedSelectors.set(selector, parsed);
  }
  return parsed;
};

const matchesCompound = (elem, compound, scope) => {
  if (compound.scope) return elem === scope;
  return (!compound.tag || elem.tagName.toUpperCase() === compound.tag)
    && compound.classes.every(c => elem._classes.has(c))
    && compound.attrs.every(([k, v]) => String(elem.getAttribute(k)) === v);
};

// Counts changes to the tree and attributes, to know when caches are stale.
let domVersion = 0;

// The elements with each id, oldest first, in any document or none.
const elementsById = new Map();
const trackId = (elem, oldId, newId) => {
  if (oldId === newId) return;
  if (oldId != null) {
    const elems = elementsById.get(oldId);
    elems?.splice(elems.indexOf(elem) >>> 0, 1);
  }
  if (newId == null) return;
  if (!elementsById.has(newId)) elementsById.set(newId, []);
  elementsById.get(newId).push(elem);
};

const rootOf = (elem) => {
  while (elem.parentElement) elem = elem.parentElement;
  return elem;
};

// Whether `elem` matches parts[0..i], with parts[i] matching `elem` itself.
const matchesParts = (elem, parts, i, scope) => {
  if (!(elem instanceof FakeElement) || !matchesCompound(elem, parts[i], scope)) {
    return false;
  }
  if (i === 0) return true;
  if (parts[i - 1] === '>') {
    return !!elem.parentElement && matchesParts(elem.parentElement, parts, i - 2, scope);
  }
  for (let a = elem.parentElement; a; a = a.parentElement) {
    if (matchesParts(a, parts, i - 2, scope)) return true;
  }
  return false;
};

class FakeClassList {
  constructor(classes) { this._classes = classes; }
  add(c) { this._classes.add(c); }
  remove(c) { this._classes.delete(c); }
  toggle(c, force = !this._classes.has(c)) {
    if (force) this._classes.add(c); else this._classes.delete(c);
    return force;
  }
  contains(c) { return this._classes.has(c); }
}

export class FakeElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName;
    this.attrs = { ...attrs };
    trackId(this, null, this.attrs.id);
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.title = '';
    this.onclick = null;
    this.onchange = null;

    this._classes = new Set();
  }

  // Made on first use: most elements never use them.
  get classList() {
    return this._classList ??= new FakeClassList(this._classes);
  }

  get style() {
    return this._style ??= {
      display: '',
      setProperty(k, v) { this[k] = v; },
    };
  }

  get id() { return this.attrs.id ?? ''; }
  set id(v) { this.setAttribute('id', v); }
  get name() { return this.attrs.name ?? ''; }
  set name(v) { this.setAttribute('name', v); }
  get type() { return this.attrs.type ?? ''; }
  set type(v) { this.attrs.type = v; }

  // The data-* attributes, by camel-cased name.
  get dataset() {
    return new Proxy({}, {
      get: (_, key) => this.getAttribute(
        'data-' + String(key).replace(/[A-Z]/g, c => '-' + c.toLowerCase())) ?? undefined,
    });
  }

  get className() { return [...this._classes].join(' '); }
  set className(v) {
    this._classes.clear();
    for (const c of String(v).split(/\s+/)) if (c) this._classes.add(c);
  }

  get childNodes() { return this.children; }
  get parentNode() { return this.parentElement; }
  get firstChild() { return this.children[0] ?? null; }
  get lastChild() { return this.children.at(-1) ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get textContent() {
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(text) {
    this.replaceChildren(...(text || text === 0 ? [String(text)] : []));
  }

  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  // As in browsers, the value attribute is the value of an untouched input.
  setAttribute(k, v) {
    domVersion++;
    if (k === 'id') trackId(this, this.attrs.id, v);
    this.attrs[k] = v;
    if (k === 'value') this.value = v;
  }
  removeAttribute(k) {
    domVersion++;
    if (k === 'id') trackId(this, this.attrs.id, null);
    delete this.attrs[k];
  }

  appendChild(child) {
    this.append(child);
    return child;
  }

  append(...nodes) {
    domVersion++;
    for (const node of nodes) {
      const child = typeof node === 'string' ? { textContent: node } : node;
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node, ref) {
    domVersion++;
    const index = this.children.indexOf(ref);
    node.parentElement = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    return node;
  }

  removeChild(node) {
    domVersion++;
    this.children.splice(this.children.indexOf(node), 1);
    node.parentElement = null;
    return node;
  }

  remove() {
    this.parentElement?.removeChild(this);
  }

  replaceWith(node) {
    this.parentElement.insertBefore(node, this);
    this.remove();
  }

  contains(node) {
    for (let e = node; e; e = e.parentElement) {
      if (e === this) return true;
    }
    return false;
  }

  // Whether the element is in the document.
  get isConnected() {
    let e = this;
    while (e.parentElement) e = e.parentElement;
    return e === globalThis.document?.body;
  }

  // A shallow copy: tag, attributes and classes, without children.
  cloneNode() {
    const copy = new this.constructor(this.tagName, this.attrs);
    for (const c of this._classes) copy.classList.add(c);
    return copy;
  }

  hasChildNodes() { return this.children.length > 0; }

  // All nodes below this one, in document order.
  descendants() {
    const nodes = [];
    const visit = (node) => {
      for (const child of node.children) {
        nodes.push(child);
        if (child.children) visit(child);
      }
    };
    visit(this);
    return nodes;
  }

  // The first element below this one, in document order, for which `pred` is
  // true.
  findDescendant(pred) {
    for (const child of this.children) {
      if (!(child instanceof FakeElement)) continue;
      if (pred(child)) return child;
      const found = child.findDescendant(pred);
      if (found) return found;
    }
    return null;
  }

  matches(selector, scope) {
    return parseSelector(selector).some(
      parts => matchesParts(this, parts, parts.length - 1, scope));
  }

  querySelectorAll(selector) {
    return this.descendants().filter(
      n => n instanceof FakeElement && n.matches(selector, this));
  }
  querySelector(selector) {
    return this.findDescendant(n => n.matches(selector, this));
  }
  getElementsByClassName(c) { return this.querySelectorAll(`.${c}`); }

  closest(selector) {
    for (let e = this; e; e = e.parentElement) {
      if (e.matches(selector)) return e;
    }
    return null;
  }

  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    const capture = options === true || !!options?.capture;
    this.listeners.get(type).push({ fn, capture });
  }

  removeEventListener(type, fn) {
    const listeners = this.listeners.get(type) ?? [];
    const index = listeners.findIndex(l => l.fn === fn);
    if (index >= 0) listeners.splice(index, 1);
  }

  // As in browsers: the ancestors' capture listeners (outermost first), then
  // this element's listeners and on<type> handler, then, if the event bubbles,
  // the ancestors' other listeners and handlers (innermost first). Stopping
  // propagation skips the elements after the current one.
  dispatch(type, event = {}) {
    const ancestors = [];
    for (let e = this.parentElement; e; e = e.parentElement) ancestors.push(e);
    const run = (e, capture) => {
      for (const l of [...e.listeners.get(type) ?? []]) {
        if (capture === undefined || l.capture === capture) l.fn(event);
      }
    };

    for (const e of ancestors.toReversed()) {
      run(e, true);
      if (event.cancelBubble) return;
    }
    run(this);
    this[`on${type}`]?.(event);
    if (!event.bubbles) return;
    for (const e of ancestors) {
      if (event.cancelBubble) return;
      run(e, false);
      e[`on${type}`]?.(event);
    }
  }

  dispatchEvent(event) {
    this.dispatch(event.type, event);
    return true;
  }

  focus() { }
  blur() { }
  select() {
    this.selectionStart = 0;
    this.selectionEnd = String(this.value).length;
  }
  setCustomValidity(message) { this.validationMessage = message; }
  reportValidity() { return !this.validationMessage; }

  click() {
    if (this.disabled) return;
    this.dispatch('click', {
      target: this,
      bubbles: true,
      preventDefault() { },
      stopPropagation() { this.cancelBubble = true; },
    });
  }
}

// A select, whose value is its selected option's. The first option is
// selected until a value is set; a value with no option selects none.
export class FakeSelect extends FakeElement {
  get options() {
    return this.descendants().filter(n => n.tagName === 'OPTION');
  }

  get value() {
    const options = this.options;
    const selected = options.find(o => o.selected)
      ?? (this._noneSelected ? null : options[0]);
    return String(selected?.value ?? '');
  }

  set value(v) {
    const options = this.options;
    for (const o of options) o.selected = String(o.value) === String(v);
    this._noneSelected = options.length > 0 && !options.some(o => o.selected);
  }
}

// The radio buttons of a form which share a name.
class FakeRadioNodeList extends Array {
  get value() { return this.find(r => r.checked)?.value ?? ''; }
  set value(v) { for (const r of this) r.checked = r.value === v; }
}

// A form, whose controls are also its properties, by name or id. As in
// browsers, they take precedence over the element's own properties.
export class FakeForm extends FakeElement {
  constructor(...args) {
    super(...args);
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        const own = Reflect.get(target, prop, receiver);
        // No control is named after a method.
        if (typeof own === 'function' || typeof prop !== 'string') return own;
        return target.namedControl(prop) || own;
      },
    });
  }

  namedControl(name) {
    if (this._controlsVersion !== domVersion) {
      this._controls = new Map();
      for (const n of this.descendants()) {
        if (!(n instanceof FakeElement)) continue;
        for (const key of new Set([n.attrs.name, n.attrs.id])) {
          if (key == null) continue;
          if (!this._controls.has(key)) this._controls.set(key, []);
          this._controls.get(key).push(n);
        }
      }
      this._controlsVersion = domVersion;
    }
    const controls = this._controls.get(name) ?? [];
    if (controls.length > 1) return FakeRadioNodeList.from(controls);
    return controls[0];
  }

  requestSubmit() {
    this.dispatch('submit', { preventDefault() { } });
  }
}

// FormData for a FakeForm: enabled controls, checkboxes and radios only when
// checked.
export class FakeFormData {
  constructor(form) { this._form = form; }

  get(name) {
    const control = this._form.descendants().find(n =>
      n instanceof FakeElement && n.name === name && !n.disabled
      && (!['checkbox', 'radio'].includes(n.type) || n.checked));
    if (!control) return null;
    return control.type === 'checkbox' ? (control.value || 'on') : control.value;
  }
}

// Builds an element: h('select', { name: 'x' }, ...children). Boolean values
// set properties (e.g. disabled), `class` sets the classes, and the rest are
// attributes.
export const h = (tag, attrs = {}, ...children) => {
  const elem = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'boolean') elem[k] = v;
    else if (k === 'class') elem.className = v;
    else elem.setAttribute(k, v);
  }
  elem.append(...children);
  return elem;
};

const TAG_CLASSES = { FORM: FakeForm, SELECT: FakeSelect };

// A document of FakeElements. A lookup by id finds an element under the body,
// else makes a new element with that id.
export const makeFakeDocument = () => {
  const listeners = new Map();
  const body = new FakeElement('BODY');
  // Newest first, since tests make a new document for each page. Elements in
  // another document's body are dropped: that document has been replaced.
  const findById = (id) => {
    const elems = elementsById.get(id) ?? [];
    for (let i = elems.length - 1; i >= 0; i--) {
      const root = rootOf(elems[i]);
      if (root === body) return elems[i];
      if (root.tagName === 'BODY') elems.splice(i, 1);
    }
    return null;
  };
  return {
    body,
    activeElement: null,
    forms: new Proxy({}, { get: (_, id) => findById(id) }),
    createElement: (tag) => new (TAG_CLASSES[tag.toUpperCase()] ?? FakeElement)(
      tag.toUpperCase()),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => ({ textContent: text }),
    getElementById: (id) => findById(id) ?? new FakeElement('DIV', { id }),
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch: (type, event = {}) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
};
