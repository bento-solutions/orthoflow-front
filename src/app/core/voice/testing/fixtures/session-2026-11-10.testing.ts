/**
 * The consultation of 10 Nov 2026 on the parity site, line by line, as the
 * recogniser returned it (docs/voice-audit-2026-11-10/session-2026-11-10.txt).
 * The patient's details in it are the test account's own; nothing here is a
 * real patient. A new scenario exported from the log viewer must have its names
 * and numbers replaced before it is committed.
 */
import { ReplayLine } from '../consultation-replay.testing';

export const SESSION_2026_11_10: ReplayLine[] = [
  { time: '22:31:58', text: "Calypso." },
  { time: '22:32:02', text: "Calypso." },
  { time: '22:32:21', text: "Donc on a, donc titulaire de la carte nationale PK 12 34 56, donc pour tout ce qui est allergie." },
  { time: '22:32:26', text: "Vous avez une allergie à l'ananas?" },
  { time: '22:32:36', text: "Pour la carte nationale, pardon, c'est BK123456." },
  { time: '22:32:52', text: "Pour les allergies, vous avez une allergie à l'ananas, vous avez une allergie à la pénicilline, et je vois aussi que vous avez une réaction au kiwi." },
  { time: '22:33:22', text: "Vous avez dit que vous avez des traitements en cours. OK, donc vous êtes, vous prenez, vous prenez du" },
  { time: '22:33:25', text: "Du paracétamol." },
  { time: '22:33:33', text: "Oui, donc vous prenez du paracétamol. OK." },
  { time: '22:33:43', text: "Et pour les antécédents médicaux, est-ce que vous avez— OK, je vois. Donc vous avez, vous êtes diabétique de type 2." },
  { time: '22:33:50', text: "Quoi encore? Vous avez la goutte? OK, je note ça." },
  { time: '22:34:08', text: "Pas diabète de type 2, diabète de type 1. OK, OK, diabète de type 1." },
  { time: '22:34:34', text: "Vous êtes OK pour votre prénom, c'est Ashraf. OK." },
  { time: '22:34:46', text: "J'écris ça avec un C." },
  { time: '22:35:09', text: "Le nom, c'est Achraf avec un C. Le prénom, le prénom, c'est Achraf avec un C." },
  { time: '22:35:36', text: "Voilà pour le plan traitement. Vous avez dit donc pour le plan traitement, donc ce qu'on va faire, on va faire une première consultation où je vais faire un bilan, voilà, sur l'état de" },
  { time: '22:35:38', text: "vos gencives et vos dents." },
  { time: '22:36:11', text: "Plan de traitement." },
  { time: '22:36:35', text: "Donc pour le plan traitement, on a dit donc vous avez, on va faire une première consultation, ça sera demain. Donc demain on fera une première consultation, on va voir" },
  { time: '22:36:40', text: "L'état de vos gencives, l'état de vos gencives et aussi de vos dents." },
  { time: '22:36:51', text: "La consultation sera à 400 dirhams." },
  { time: '22:37:18', text: "Voilà, donc pour vos dents, donc je vois que vous avez des soins antécédents déjà sur la dent 18, donc soins en place." },
  { time: '22:37:39', text: "Donc vous avez dans 16 caries occlusales." },
  { time: '22:38:32', text: "C'est le schéma dentaire dont 11 caries occlusales." },
  { time: '22:38:57', text: "On peut commencer le Calypso schéma dentaire. Calypso schéma dentaire." },
  { time: '22:39:06', text: "On dit zuite, carie occlusale." },
  { time: '22:39:39', text: "Calypso, dis-moi comment j'interagis avec le schéma dentaire." },
  { time: '22:40:22', text: "Dans 11 carrés." },
  { time: '22:40:28', text: "dont 12 absentes." },
  { time: '22:40:34', text: "Dent 13, carie." },
  { time: '22:40:41', text: "dont 24 absentes." },
  { time: '22:40:49', text: "38 carré occlusal." },
  { time: '22:40:57', text: "Dent 38, carie occlusale." },
  { time: '22:41:06', text: "dont 35 absentes." },
  { time: '22:41:14', text: "44, 43 et 45 couronnes." },
  { time: '22:41:28', text: "Non, donc 45, c'est pas couronne, amalgame." },
  { time: '22:41:55', text: "Donc merci monsieur pour cette session. Donc notre prochain rendez-vous, ça sera pour demain à 10 heures, donc pour qu'on continue." },
  { time: '22:42:39', text: "Calypso, stop, fin de consultation." },
];
