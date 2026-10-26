import { el, field, textArea, textInput, type FormView } from './dom'
import type { RawLabelForm, RawParty } from './forms'

function partyFields(title: string, party: RawParty) {
  const name = textInput(party.name)
  const phone = textInput(party.phone)
  const address = textArea(party.address, 3)
  return {
    nodes: [el('h3', { textContent: title }), field('Name', name), field('Phone', phone), field('Address (one line per row)', address)],
    read: (): RawParty => ({ name: name.value, phone: phone.value, address: address.value }),
  }
}

export function createLabelForm(): FormView<RawLabelForm> {
  const listeners: Array<() => void> = []
  const notify = () => listeners.forEach((cb) => cb())

  const courier = textInput('JNE REG')
  const trackingNumber = textInput('JNE1234567890')
  const orderId = textInput('ORD-77')
  const weightGrams = textInput('1250')
  const note = textInput('')
  const includeQr = el('input', { type: 'checkbox', checked: true })

  const recipient = partyFields('Recipient (TO)', {
    name: 'Budi Santoso',
    phone: '0812-0000-1111',
    address: 'Jl. Melati 5 RT 02/03\nBandung 40111',
  })
  const sender = partyFields('Sender (FROM)', {
    name: 'Toko Contoh',
    phone: '021-555-0100',
    address: 'Jl. Contoh No. 1\nJakarta 10110',
  })

  const element = el('div', { className: 'form' })
  element.append(
    field('Courier / service', courier),
    field('Tracking number', trackingNumber),
    field('Order id', orderId),
    field('Weight (grams)', weightGrams),
    field('Note', note),
    field('Print QR code', includeQr),
    ...recipient.nodes,
    ...sender.nodes,
  )
  element.addEventListener('input', notify)

  return {
    element,
    onChange: (cb) => {
      listeners.push(cb)
    },
    read: () => ({
      courier: courier.value,
      trackingNumber: trackingNumber.value,
      orderId: orderId.value,
      weightGrams: weightGrams.value,
      note: note.value,
      includeQr: includeQr.checked,
      recipient: recipient.read(),
      sender: sender.read(),
    }),
  }
}
