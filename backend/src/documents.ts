import PDFDocument from 'pdfkit';
import { Invoice, Passenger, Purchase, Ticket, Departure, Flight, Airport, Class, type IdModel, type PurchaseModel } from './db/index.js';
import type { Transaction } from 'sequelize';

type TicketDocument = {
  id: number;
  ticketCode: string;
  passenger: { firstName: string; lastName: string; document: string };
  flightNumber: string;
  origin: string;
  destination: string;
  date: string;
  departureTime: string;
  arrivalTime: string;
  arrivalNextDay: boolean;
  className: string;
  price: number;
};

type InvoiceDocument = {
  number: string;
  issuedAt: Date;
  total: number;
  holderName: string;
  holderEmail: string;
  tickets: TicketDocument[];
};

function renderPdf(title: string, lines: string[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 52 });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.fontSize(20).text(title);
    document.moveDown();
    document.fontSize(11);
    for (const line of lines) document.text(line);
    document.end();
  });
}

export async function ensurePurchaseInvoice(purchaseId: number, transaction?: Transaction) {
  const purchase = await Purchase.findByPk(purchaseId, { transaction });
  if (!purchase || purchase.status !== 'CONFIRMED') return null;
  const [invoice] = await Invoice.findOrCreate({
    where: { purchaseId },
    defaults: {
      purchaseId,
      number: `SIGVA-${String(purchaseId).padStart(8, '0')}`,
      total: Number(purchase.total),
      issuedAt: new Date()
    },
    transaction
  });
  return invoice;
}

async function loadPurchaseDocuments(purchaseId: number): Promise<InvoiceDocument | null> {
  const purchase = await Purchase.findByPk(purchaseId);
  if (!purchase || purchase.status !== 'CONFIRMED') return null;
  const invoice = await ensurePurchaseInvoice(purchaseId);
  const holder = await Passenger.findByPk(purchase.passengerId);
  const tickets = await Ticket.findAll({ where: { purchaseId }, order: [['id', 'ASC']] });
  const passengerData = typeof purchase.passengerData === 'string'
    ? JSON.parse(purchase.passengerData) as Array<{ firstName: string; lastName: string; document: string }>
    : [];
  const details: TicketDocument[] = [];

  for (const [index, ticket] of tickets.entries()) {
    const departure = await Departure.findByPk(Number(ticket.departureId));
    const flight = departure ? await Flight.findByPk(departure.flightId) : null;
    const origin = flight ? await Airport.findByPk(flight.originAirportId) : null;
    const destination = flight ? await Airport.findByPk(flight.destinationAirportId) : null;
    const fareClass = await Class.findByPk(Number(ticket.classId));
    if (!departure || !flight || !origin || !destination || !fareClass) continue;
    const passenger = passengerData[index] ?? {
      firstName: holder?.firstName ?? '',
      lastName: holder?.lastName ?? '',
      document: holder?.documentNumber ?? ''
    };
    details.push({
      id: ticket.id,
      ticketCode: String(ticket.ticketCode),
      passenger,
      flightNumber: flight.flightNumber,
      origin: origin.iata,
      destination: destination.iata,
      date: departure.date,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      arrivalNextDay: flight.arrivalTime <= flight.departureTime,
      className: String(fareClass.name),
      price: Number(ticket.price)
    });
  }

  return {
    number: String(invoice?.get('number') ?? ''),
    issuedAt: new Date(invoice?.get('issuedAt') as Date),
    total: Number(invoice?.get('total') ?? purchase.total),
    holderName: `${holder?.firstName ?? ''} ${holder?.lastName ?? ''}`.trim(),
    holderEmail: holder?.email ?? '',
    tickets: details
  };
}

export async function createTicketPdf(purchaseId: number, ticketId: number) {
  const purchase = await loadPurchaseDocuments(purchaseId);
  const ticket = purchase?.tickets.find((item) => item.id === ticketId);
  if (!ticket) return null;
  const arrival = `${ticket.arrivalTime}${ticket.arrivalNextDay ? ' +1' : ''}`;
  return renderPdf('Pasaje electrónico SIGVA', [
    `Código de pasaje: ${ticket.ticketCode}`,
    `Pasajero: ${ticket.passenger.firstName} ${ticket.passenger.lastName}`,
    `Documento: ${ticket.passenger.document}`,
    `Vuelo: ${ticket.flightNumber}`,
    `Ruta: ${ticket.origin} - ${ticket.destination}`,
    `Fecha: ${ticket.date}`,
    `Partida: ${ticket.departureTime}`,
    `Llegada: ${arrival}`,
    `Clase: ${ticket.className}`
  ]);
}

export async function createInvoicePdf(purchaseId: number) {
  const invoice = await loadPurchaseDocuments(purchaseId);
  if (!invoice) return null;
  const lines = [
    `Número: ${invoice.number}`,
    `Fecha: ${invoice.issuedAt.toLocaleDateString('es-AR')}`,
    `Titular: ${invoice.holderName}`,
    `Email: ${invoice.holderEmail}`,
    'Detalle de pasajes:',
    ...invoice.tickets.map((ticket) => `${ticket.ticketCode} | ${ticket.passenger.firstName} ${ticket.passenger.lastName} | ${ticket.flightNumber} ${ticket.origin}-${ticket.destination} | ${ticket.date} | ${ticket.className} | $${ticket.price.toFixed(2)}`),
    `Total: $${invoice.total.toFixed(2)}`
  ];
  return renderPdf('Factura SIGVA', lines);
}

export async function createPurchaseAttachments(purchaseId: number) {
  const invoice = await loadPurchaseDocuments(purchaseId);
  if (!invoice) return [];
  const attachments = await Promise.all(invoice.tickets.map(async (ticket) => ({
    filename: `pasaje-${ticket.ticketCode}.pdf`,
    content: await createTicketPdf(purchaseId, ticket.id),
    contentType: 'application/pdf'
  })));
  const invoicePdf = await createInvoicePdf(purchaseId);
  if (invoicePdf) attachments.push({ filename: `factura-${invoice.number}.pdf`, content: invoicePdf, contentType: 'application/pdf' });
  return attachments.filter((attachment): attachment is { filename: string; content: Buffer; contentType: string } => attachment.content instanceof Buffer);
}