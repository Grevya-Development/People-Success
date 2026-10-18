/**
 * E-signature adapter.
 *
 * PeopleSuccess does NOT apply an electronic signature to offer letters.
 * Candidates accept by click-through on the secure offer page; the record
 * (timestamp, IP, note) is stored on the offer and shown as "Accepted
 * electronically by click-through". The offer's esign_* columns stay null
 * unless a configured provider confirms a signature.
 *
 * To integrate a provider (e.g. an Aadhaar eSign ASP or DocuSign), implement
 * `EsignProvider`, register it with `setEsignProvider` at start-up, and have
 * its webhook call back into the offers service to record envelope status.
 */
export type EsignEnvelope = { envelopeId: string; signingUrl: string };

export interface EsignProvider {
  readonly name: string;
  /** Send the letter for signature; returns the provider's envelope reference. */
  createEnvelope(input: { offerId: string; documentBytes: Uint8Array; signerName: string; signerEmail: string }): Promise<EsignEnvelope>;
  /** Current provider status, e.g. "sent" | "completed" | "declined". */
  status(envelopeId: string): Promise<string>;
}

let provider: EsignProvider | null = null;

export function setEsignProvider(p: EsignProvider | null) {
  provider = p;
}

export function getEsignProvider(): EsignProvider | null {
  return provider;
}

export function esignStatus(): { configured: boolean; label: string } {
  return provider
    ? { configured: true, label: `E-signature via ${provider.name}` }
    : { configured: false, label: "E-signature is not configured. Candidates accept electronically by click-through; no signature is applied." };
}
