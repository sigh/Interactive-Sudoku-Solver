// A minimal fake DOM for UI tests that run in Node. It records what the code
// builds (tree, attributes, classes, styles, listeners) and supports the few
// behaviours tests rely on, such as click() being ignored while disabled.

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

  get childNodes() { return this.children; }
  get parentNode() { return this.parentElement; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get textContent() {
    return this.children.map(c => c.textContent).join('');
  }

  set textContent(text) {
    this.replaceChildren(...(text ? [String(text)] : []));
  }

  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = v; }

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

  querySelector() { return null; }
  querySelectorAll() { return []; }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  dispatchEvent() { }
  focus() { }
  blur() { }
  select() { }

  click() {
    if (!this.disabled) this.onclick?.();
  }
}

// For tests of code that navigates to elements the test didn't build: missing
// parents, first children and siblings are stand-ins instead of null.
export class StubElement extends FakeElement {
  get parentElement() { return this._parent ?? new StubElement('div'); }
  set parentElement(v) { this._parent = v; }
  get firstElementChild() { return super.firstElementChild ?? new StubElement('div'); }
  get nextElementSibling() { return super.nextElementSibling ?? new StubElement('div'); }
}

// A document whose elements are `Element`s. getElementById returns `byId[id]`,
// else a new element with that id.
export const makeFakeDocument = ({ Element = FakeElement, byId = {} } = {}) => {
  const listeners = new Map();
  return {
    byId,
    activeElement: null,
    body: new Element('BODY'),
    createElement: (tag) => new Element(tag.toUpperCase()),
    createElementNS: (_ns, tag) => new Element(tag),
    createTextNode: (text) => ({ textContent: text }),
    getElementById: (id) => byId[id] ?? new Element('DIV', { id }),
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch: (type, event = {}) => {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
};
