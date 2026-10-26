import { el, field, textArea, textInput, type FormView } from './dom'
import type { RawReceiptForm } from './forms'

export function createReceiptForm(now: Date = new Date()): FormView<RawReceiptForm> {
  const listeners: Array<() => void> = []
  const notify = () => listeners.forEach((cb) => cb())

  const storeName = textInput('Toko Contoh')
  const address = textArea('Jl. Contoh No. 1\nJakarta', 2)
  const dateTime = textInput(now.toLocaleString('id-ID'))
  const receiptNo = textInput('INV-001')
  const cashier = textInput('')
  const taxPercent = textInput('0')
  const discount = textInput('0')
  const paid = textInput('')
  const footer = textInput('Terima kasih')

  const rows = el('div', { className: 'items' })
  function addRow(name = '', qty = '1', price = ''): void {
    const row = el('div', { className: 'item-row' })
    const nameInput = textInput(name, 'Item')
    const qtyInput = textInput(qty, 'Qty')
    const priceInput = textInput(price, 'Price')
    nameInput.dataset.col = 'name'
    qtyInput.dataset.col = 'qty'
    priceInput.dataset.col = 'price'
    const remove = el('button', { type: 'button', textContent: 'Remove' })
    remove.addEventListener('click', () => {
      row.remove()
      notify()
    })
    row.append(nameInput, qtyInput, priceInput, remove)
    rows.append(row)
  }
  addRow('Nasi Goreng', '2', '15000')
  addRow('Es Teh', '1', '5000')

  const add = el('button', { type: 'button', textContent: 'Add item' })
  add.addEventListener('click', () => {
    addRow()
    notify()
  })

  const element = el('div', { className: 'form' })
  element.append(
    field('Store name', storeName),
    field('Address (one line per row)', address),
    field('Date / time', dateTime),
    field('Receipt no.', receiptNo),
    field('Cashier', cashier),
    el('h3', { textContent: 'Items' }),
    rows,
    add,
    field('Tax %', taxPercent),
    field('Discount', discount),
    field('Paid', paid),
    field('Footer', footer),
  )
  element.addEventListener('input', notify)

  const cell = (row: HTMLElement, col: string) =>
    row.querySelector<HTMLInputElement>(`[data-col="${col}"]`)!.value

  return {
    element,
    onChange: (cb) => {
      listeners.push(cb)
    },
    read: () => ({
      storeName: storeName.value,
      address: address.value,
      dateTime: dateTime.value,
      receiptNo: receiptNo.value,
      cashier: cashier.value,
      items: Array.from(rows.querySelectorAll<HTMLElement>('.item-row')).map((row) => ({
        name: cell(row, 'name'),
        qty: cell(row, 'qty'),
        price: cell(row, 'price'),
      })),
      taxPercent: taxPercent.value,
      discount: discount.value,
      paid: paid.value,
      footer: footer.value,
    }),
  }
}
