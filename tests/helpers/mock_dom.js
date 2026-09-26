// A minimal fake DOM for UI tests that run in Node. It records what the code
// builds (tree, attributes, classes, styles, listeners) and supports the few
// behaviours tests rely on, such as click() being ignored while disabled.

// Simple selectors only: a tag, classes and [attr="value"]s, e.g.
// 'input[type="checkbox"]' or 'div.description'.
const SELECTOR_RE = /^([a-zA-Z]*)((?:\.[\w-]+)*)((?:\[[\w-]+="[^"]*"\])*)$/;

export class FakeElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName;
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.title = '';
    this.onclick = null;
    this.onchange = null;

    const classes = this._classes = new Set();
    this.classList = {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force = !classes.has(c)) => {
        if (force) classes.add(c); else classes.delete(c);
        return force;
      },
      contains: (c) => classes.has(c),
    };

    this.style = {
      display: '',
      setProperty(k, v) { this[k] = v; },
    };
  }

  get id() { return this.attrs.id ?? ''; }
  set id(v) { this.attrs.id = v; }
  get name() { return this.attrs.name ?? ''; }
  set name(v) { this.attrs.name = v; }
  get type() { return this.attrs.type ?? ''; }
  set type(v) { this.attrs.type = v; }

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
    this.attrs[k] = v;
    if (k === 'value') this.value = v;
  }
  removeAttribute(k) { delete this.attrs[k]; }

  appendChild(child) {
    this.append(child);
    return child;
  }

  append(...nodes) {
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
    const index = this.children.indexOf(ref);
    node.parentElement = this;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    return node;
  }

  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1);
    node.parentElement = null;
    return node;
  }

  remove() {
    this.parentElement?.removeChild(this);
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
    return this.children.flatMap(c => [c, ...(c.descendants?.() ?? [])]);
  }

  matches(selector) {
    const [, tag, classes, attrs] = selector.match(SELECTOR_RE);
    return (!tag || this.tagName.toLowerCase() === tag.toLowerCase())
      && classes.split('.').slice(1).every(c => this._classes.has(c))
      && [...attrs.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].every(
        ([, k, v]) => String(this.getAttribute(k)) === v);
  }

  querySelectorAll(selector) {
    return this.descendants().filter(
      n => n instanceof FakeElement && n.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getElementsByClassName(c) { return this.querySelectorAll(`.${c}`); }

  closest(selector) {
    for (let e = this; e; e = e.parentElement) {
      if (e.matches(selector)) return e;
    }
    return null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  // Calls the listeners and the on<type> handler, then the ancestors' if the
  // event bubbles.
  dispatch(type, event = {}) {
    for (let e = this; e; e = event.bubbles ? e.parentElement : null) {
      for (const fn of e.listeners.get(type) ?? []) fn(event);
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
    if (!this.disabled) this.dispatch('click', { preventDefault() { } });
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
      get: (target, prop, receiver) => (typeof prop === 'string'
        && target.namedControl(prop)) || Reflect.get(target, prop, receiver),
    });
  }

  namedControl(name) {
    const controls = this.descendants().filter(n => n instanceof FakeElement
      && (n.name === name || n.getAttribute('id') === name));
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
  const findById = (id) => body.descendants().find(
    n => n instanceof FakeElement && n.getAttribute('id') === id);
  return {
    body,
    activeElement: null,
    forms: new Proxy({}, { get: (_, id) => findById(id) }),
    createElement: (tag) => new (TAG_CLASSES[tag.toUpperCase()] ?? FakeElement)(
      tag.toUpperCase()),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => ({ textContent: text }),
    getElementById: (id) => findById(id) ?? new FakeElement('DIV', { id }),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch: (type, event = {}) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
};
