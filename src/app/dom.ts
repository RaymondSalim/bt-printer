export interface FormView<T> {
  element: HTMLElement
  read(): T
  onChange(cb: () => void): void
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children)
  return node
}

export function field(label: string, control: HTMLElement): HTMLLabelElement {
  return el('label', { className: 'field' }, [el('span', { textContent: label }), control])
}

export function textInput(value = '', placeholder = ''): HTMLInputElement {
  return el('input', { type: 'text', value, placeholder })
}

export function textArea(value = '', rows = 3): HTMLTextAreaElement {
  return el('textarea', { value, rows })
}
