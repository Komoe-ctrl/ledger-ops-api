import { Injectable } from "@nestjs/common";

/**
 * Abstraction de "maintenant" — jamais `new Date()` directement dans du
 * code métier qui doit rester testable. En test, on substitue ce provider
 * par une horloge figée : la seule façon de créer une transaction déjà
 * échue de façon déterministe, une fois `expires_at` gelé après création
 * (voir migration freeze_expires_at) — impossible de la truquer après
 * coup par une mutation directe.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
