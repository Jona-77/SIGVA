import { randomUUID } from 'node:crypto';

export type VerifiedPaymentStatus = 'approved' | 'rejected' | 'pending';

export type PaymentPurchase = {
  id: number;
  total: number;
  quantity: number;
  flightNumber: string;
  departureDate: string;
  origin: string;
  destination: string;
  className: string;
};

export type VerifiedPayment = {
  reference: string;
  status: VerifiedPaymentStatus;
  amount: number;
  externalReference: string;
  paidAt: Date | null;
};

export interface PaymentGateway {
  createPaymentSession(purchase: PaymentPurchase): Promise<{ url: string; reference?: string }>;
  verifyPayment(reference: string): Promise<VerifiedPayment>;
  setSandboxResult?(reference: string, purchaseId: number, status: VerifiedPaymentStatus): void;
}

type GatewayOptions = {
  accessToken?: string;
  clientUrl?: string;
};

type MercadoPagoPreference = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
};

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  transaction_amount?: number;
  external_reference?: string;
  date_approved?: string | null;
};

class LocalSandboxPaymentGateway implements PaymentGateway {
  private readonly sessions = new Map<string, { purchaseId: number; amount: number; status?: VerifiedPaymentStatus }>();

  constructor(private readonly clientUrl: string) {}

  async createPaymentSession(purchase: PaymentPurchase) {
    const reference = `local-${purchase.id}-${randomUUID()}`;
    this.sessions.set(reference, { purchaseId: purchase.id, amount: purchase.total });
    const url = new URL(`/pago/local-sandbox/${purchase.id}`, this.clientUrl);
    url.searchParams.set('reference', reference);
    return { url: url.toString(), reference };
  }

  async verifyPayment(reference: string): Promise<VerifiedPayment> {
    const session = this.sessions.get(reference);
    if (!session?.status) {
      throw new Error('La sesión de pago local no tiene un resultado verificado.');
    }
    return {
      reference,
      status: session.status,
      amount: session.amount,
      externalReference: String(session.purchaseId),
      paidAt: session.status === 'approved' ? new Date() : null
    };
  }

  setSandboxResult(reference: string, purchaseId: number, status: VerifiedPaymentStatus) {
    const session = this.sessions.get(reference);
    if (!session || session.purchaseId !== purchaseId) {
      throw new Error('La referencia de pago local no pertenece a esta compra.');
    }
    session.status = status;
  }
}

class MercadoPagoPaymentGateway implements PaymentGateway {
  constructor(private readonly accessToken: string, private readonly clientUrl: string) {}

  async createPaymentSession(purchase: PaymentPurchase) {
    const result = await this.request<MercadoPagoPreference>('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{
          id: String(purchase.id),
          title: `${purchase.flightNumber} ${purchase.origin}-${purchase.destination} ${purchase.departureDate} ${purchase.className}`,
          quantity: purchase.quantity,
          currency_id: 'ARS',
          unit_price: purchase.total / purchase.quantity
        }],
        external_reference: String(purchase.id),
        back_urls: {
          success: `${this.clientUrl}/pago/resultado/${purchase.id}`,
          failure: `${this.clientUrl}/pago/resultado/${purchase.id}`,
          pending: `${this.clientUrl}/pago/resultado/${purchase.id}`
        },
        auto_return: 'approved'
      })
    });
    const url = result.sandbox_init_point ?? result.init_point;
    if (!url) throw new Error('Mercado Pago no devolvió una URL de Checkout Pro.');
    return { url, reference: result.id };
  }

  async verifyPayment(reference: string): Promise<VerifiedPayment> {
    const payment = await this.request<MercadoPagoPayment>(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(reference)}`
    );
    if (!payment.id || !payment.status || !payment.external_reference || !Number.isFinite(Number(payment.transaction_amount))) {
      throw new Error('Mercado Pago devolvió datos de pago incompletos.');
    }
    const status = payment.status === 'approved'
      ? 'approved'
      : ['rejected', 'cancelled'].includes(payment.status) ? 'rejected' : 'pending';
    return {
      reference: String(payment.id),
      status,
      amount: Number(payment.transaction_amount),
      externalReference: payment.external_reference,
      paidAt: payment.date_approved ? new Date(payment.date_approved) : null
    };
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!response.ok) throw new Error('No se pudo verificar la operación con Mercado Pago.');
    return response.json() as Promise<T>;
  }
}

export function createPaymentGateway(mode = process.env.PAYMENT_GATEWAY, options: GatewayOptions = {}): PaymentGateway {
  const clientUrl = options.clientUrl ?? process.env.CLIENT_URL ?? 'http://localhost:5173';
  if (mode === 'mercadopago') {
    const accessToken = options.accessToken ?? process.env.MP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('MP_ACCESS_TOKEN es obligatorio para PAYMENT_GATEWAY=mercadopago.');
    return new MercadoPagoPaymentGateway(accessToken, clientUrl);
  }
  if (mode && mode !== 'local-sandbox') {
    throw new Error('PAYMENT_GATEWAY debe ser mercadopago o local-sandbox.');
  }
  return new LocalSandboxPaymentGateway(clientUrl);
}