/**
 * Convention de nommage, pas une FK — voir le commentaire sur le modèle
 * Merchant dans schema.prisma. Utilisé à la création d'un marchand
 * (payable initial) ET par les fonctions de comptabilisation
 * (payment/refund/dispute-*-booking.ts) qui doivent retrouver ce compte.
 * Une seule fonction, pour ne jamais désynchroniser les deux usages.
 */
export function merchantPayableAccountCode(merchantCode: string): string {
  return `merchant:${merchantCode}:payable`;
}
