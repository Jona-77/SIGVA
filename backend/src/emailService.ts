import nodemailer, { type Transporter } from 'nodemailer';
import { EmailDelivery, Passenger, Purchase } from './db/index.js';
import { createPurchaseAttachments } from './documents.js';

type DeliveryKind = 'DOCUMENTS' | 'SCHEDULE_CHANGE' | 'CANCELLATION';

let injectedTransport: Transporter | null = null;
let testTransport: Promise<Transporter> | null = null;

export function setEmailTransport(transport: Transporter | null = null) {
  injectedTransport = transport;
}

async function getTransport() {
  if (injectedTransport) return injectedTransport;
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  testTransport ??= nodemailer.createTestAccount().then((account) => nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass }
  }));
  return testTransport;
}

async function send(delivery: InstanceType<typeof EmailDelivery>) {
  if (delivery.deliveryStatus === 'SENT') return delivery;
  delivery.deliveryStatus = 'PENDING';
  delivery.attempts = Number(delivery.attempts ?? 0) + 1;
  delivery.lastError = null;
  await delivery.save();
  try {
    const attachments = delivery.kind === 'DOCUMENTS'
      ? await createPurchaseAttachments(Number(delivery.purchaseId))
      : [];
    const transport = await getTransport();
    const result = await transport.sendMail({
      from: 'SIGVA <no-reply@sigva.test>',
      to: delivery.recipient,
      subject: delivery.subject,
      text: delivery.text,
      attachments
    });
    const previewUrl = nodemailer.getTestMessageUrl(result);
    if (previewUrl) console.info(`Email de prueba disponible en ${previewUrl}`);
    delivery.deliveryStatus = 'SENT';
    delivery.sentAt = new Date();
    await delivery.save();
  } catch (error) {
    delivery.deliveryStatus = 'FAILED';
    delivery.lastError = error instanceof Error ? error.message : 'Fallo de envío';
    await delivery.save();
  }
  return delivery;
}

async function findOrCreateDelivery(input: {
  purchaseId: number;
  eventKey: string;
  kind: DeliveryKind;
  recipient: string;
  subject: string;
  text: string;
}) {
  const [delivery] = await EmailDelivery.findOrCreate({
    where: { purchaseId: input.purchaseId, eventKey: input.eventKey },
    defaults: { ...input, deliveryStatus: 'PENDING', attempts: 0, lastError: null, sentAt: null }
  });
  return delivery;
}

export async function sendPurchaseDocuments(purchaseId: number) {
  const purchase = await Purchase.findByPk(purchaseId);
  const passenger = purchase ? await Passenger.findByPk(purchase.passengerId) : null;
  if (!purchase || purchase.status !== 'CONFIRMED' || !passenger || !passenger.email) return null;
  const delivery = await findOrCreateDelivery({
    purchaseId,
    eventKey: `documents-${purchaseId}`,
    kind: 'DOCUMENTS',
    recipient: passenger.email,
    subject: `Pasajes electrónicos y factura de la compra ${purchaseId}`,
    text: 'Adjuntamos los pasajes electrónicos y la factura de su compra SIGVA.'
  });
  return send(delivery);
}

export async function sendPurchaseAlert(input: {
  purchaseId: number;
  eventKey: string;
  kind: 'SCHEDULE_CHANGE' | 'CANCELLATION';
  recipient: string;
  subject: string;
  text: string;
}) {
  const delivery = await findOrCreateDelivery(input);
  return send(delivery);
}

export async function retryPurchaseEmails(purchaseId: number) {
  const failed = await EmailDelivery.findAll({ where: { purchaseId, deliveryStatus: 'FAILED' }, order: [['id', 'ASC']] });
  const retried = await Promise.all(failed.map((delivery) => send(delivery)));
  return retried.map((delivery) => ({ id: delivery.id, status: delivery.deliveryStatus, attempts: delivery.attempts }));
}

export async function getPurchaseDocumentEmail(purchaseId: number) {
  const delivery = await EmailDelivery.findOne({ where: { purchaseId, eventKey: `documents-${purchaseId}` } });
  return delivery ? { status: delivery.deliveryStatus, attempts: delivery.attempts } : null;
}

export async function getPurchaseEmailDeliveries(purchaseId: number) {
  const deliveries = await EmailDelivery.findAll({ where: { purchaseId }, order: [['id', 'ASC']] });
  return deliveries.map((delivery) => ({
    id: delivery.id,
    kind: delivery.kind,
    status: delivery.deliveryStatus,
    attempts: delivery.attempts
  }));
}