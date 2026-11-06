import type { Branch } from './master.js';

export interface UnspecServiceArea { branch: Branch; label: string; stos: readonly string[] }

// Presentation order and labels follow the supplied regional report template.
export const UNSPEC_SERVICE_AREAS: readonly UnspecServiceArea[] = [
  { branch: 'MAKASSAR', label: 'SA BALAIKOTA', stos: ['BAL', 'MAT'] },
  { branch: 'MAKASSAR', label: 'SA PANAKUKANG', stos: ['PNK'] },
  { branch: 'MAKASSAR', label: 'SA TAMALANREA', stos: ['ANT', 'TMA'] },
  { branch: 'MAKASSAR', label: 'SA SUNGGUMINASA', stos: ['JNP', 'MAL', 'SUG', 'TKA'] },
  { branch: 'MAKASSAR', label: 'SA SUDIANG', stos: ['KIM', 'SUD'] },
  { branch: 'MAKASSAR', label: 'SA MAROS', stos: ['BAR', 'MAR', 'PKN'] },
  { branch: 'BONE', label: 'SA BONE', stos: ['SIN', 'WTP'] },
  { branch: 'BONE', label: 'SA BANTAENG', stos: ['BTN', 'BLK', 'SLY'] },
  { branch: 'BONE', label: 'SA WAJO', stos: ['AJN', 'CGI', 'SKG', 'SIW', 'WTG'] },
  { branch: 'PARE-PARE', label: 'SA PARE PARE', stos: ['PRE'] },
  { branch: 'PARE-PARE', label: 'SA PINRANG', stos: ['ENR', 'PIN', 'RPN', 'SID', 'TTE'] },
  { branch: 'PARE-PARE', label: 'SA TANA TORAJA', stos: ['MAK', 'RTP'] },
  { branch: 'PARE-PARE', label: 'SA PALOPO', stos: ['PLP'] },
  { branch: 'PARE-PARE', label: 'SA MAJENE', stos: ['MAJ', 'MMS', 'PLW', 'WON'] },
  { branch: 'PARE-PARE', label: 'SA MAMUJU', stos: ['MAM'] },
  { branch: 'PARE-PARE', label: 'SA LUTRA', stos: ['MAS', 'MLL', 'SRK'] },
  { branch: 'KENDARI', label: 'SA KENDARI', stos: ['KDR'] },
  { branch: 'KENDARI', label: 'SA MANDONGA', stos: ['MDG'] },
  { branch: 'KENDARI', label: 'SA UNAHA', stos: ['UNH'] },
  { branch: 'KENDARI', label: 'SA KOLAKA', stos: ['KKA', 'PMA', 'LSS'] },
  { branch: 'KENDARI', label: 'SA BAUBAU', stos: ['BBU', 'RAH', 'WNC'] },
];
