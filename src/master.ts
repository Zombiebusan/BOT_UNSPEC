export const BRANCHES = ['BONE', 'KENDARI', 'MAKASSAR', 'PARE-PARE'] as const;
export type Branch = (typeof BRANCHES)[number];
export interface StoMaster { branch: Branch; lis: number }

export const LIS_EFFECTIVE_FROM = '2026-11-01';
export const LIS_SOURCE = 'UNSPEC-Sulbagsel-Dashboard-November-2026.html';

// Mapping dan customers dashboard November, tanpa mengimpor snapshot tiket.
export const MASTER: Record<string, StoMaster> = {
  BBU: { branch: 'KENDARI', lis: 14476 },
  RAH: { branch: 'KENDARI', lis: 3376 },
  WNC: { branch: 'KENDARI', lis: 2433 },
  KDR: { branch: 'KENDARI', lis: 15891 },
  KKA: { branch: 'KENDARI', lis: 5912 },
  LSS: { branch: 'KENDARI', lis: 1938 },
  PMA: { branch: 'KENDARI', lis: 2634 },
  MDG: { branch: 'KENDARI', lis: 31445 },
  UNH: { branch: 'KENDARI', lis: 8036 },
  BAL: { branch: 'MAKASSAR', lis: 19456 },
  MAT: { branch: 'MAKASSAR', lis: 21245 },
  BLK: { branch: 'BONE', lis: 7650 },
  BTN: { branch: 'BONE', lis: 3542 },
  JNP: { branch: 'MAKASSAR', lis: 4233 },
  SLY: { branch: 'BONE', lis: 2419 },
  SIN: { branch: 'BONE', lis: 5130 },
  WTP: { branch: 'BONE', lis: 11369 },
  MAR: { branch: 'MAKASSAR', lis: 5625 },
  PKN: { branch: 'MAKASSAR', lis: 6520 },
  ANT: { branch: 'MAKASSAR', lis: 8946 },
  PNK: { branch: 'MAKASSAR', lis: 30500 },
  KIM: { branch: 'MAKASSAR', lis: 1954 },
  SUD: { branch: 'MAKASSAR', lis: 15412 },
  MAL: { branch: 'MAKASSAR', lis: 710 },
  SUG: { branch: 'MAKASSAR', lis: 20041 },
  TKA: { branch: 'MAKASSAR', lis: 5266 },
  TMA: { branch: 'MAKASSAR', lis: 11636 },
  MAJ: { branch: 'PARE-PARE', lis: 4575 },
  MMS: { branch: 'PARE-PARE', lis: 1525 },
  PLW: { branch: 'PARE-PARE', lis: 4776 },
  WON: { branch: 'PARE-PARE', lis: 3410 },
  MAK: { branch: 'PARE-PARE', lis: 4844 },
  RTP: { branch: 'PARE-PARE', lis: 7757 },
  MAM: { branch: 'PARE-PARE', lis: 10885 },
  MAS: { branch: 'PARE-PARE', lis: 6092 },
  MLL: { branch: 'PARE-PARE', lis: 1748 },
  SRK: { branch: 'PARE-PARE', lis: 5924 },
  PLP: { branch: 'PARE-PARE', lis: 19116 },
  BAR: { branch: 'MAKASSAR', lis: 4210 },
  PRE: { branch: 'PARE-PARE', lis: 13804 },
  PIN: { branch: 'PARE-PARE', lis: 8926 },
  ENR: { branch: 'PARE-PARE', lis: 2849 },
  RPN: { branch: 'PARE-PARE', lis: 1984 },
  SID: { branch: 'PARE-PARE', lis: 6630 },
  TTE: { branch: 'PARE-PARE', lis: 1087 },
  AJN: { branch: 'BONE', lis: 505 },
  CGI: { branch: 'BONE', lis: 2031 },
  SIW: { branch: 'BONE', lis: 833 },
  SKG: { branch: 'BONE', lis: 9695 },
  WTG: { branch: 'BONE', lis: 4360 }
};

// Acuan Oktober tetap tersedia untuk upload historis sebelum 1 November 2026.
const OCTOBER_LIS: Record<string, number> = {
  BBU: 14416, RAH: 3253, WNC: 2262, KDR: 15621, KKA: 5543, LSS: 1908, PMA: 2466, MDG: 30779, UNH: 7433,
  BAL: 20028, MAT: 21017, BLK: 6942, BTN: 3307, JNP: 3842, SLY: 2342, SIN: 4640, WTP: 10863,
  MAR: 5463, PKN: 6121, ANT: 8618, PNK: 30173, KIM: 2092, SUD: 14662, MAL: 629, SUG: 19365, TKA: 4968, TMA: 11331,
  MAJ: 4506, MMS: 1436, PLW: 4672, WON: 3347, MAK: 4593, RTP: 7306, MAM: 10503, MAS: 5703, MLL: 1688,
  SRK: 5643, PLP: 18335, BAR: 3989, PRE: 13462, PIN: 8478, ENR: 2777, RPN: 1823, SID: 6342, TTE: 889,
  AJN: 476, CGI: 1873, SIW: 812, SKG: 9218, WTG: 4127
};
export const OCTOBER_MASTER: Record<string, StoMaster> = Object.fromEntries(
  Object.entries(MASTER).map(([code, sto]) => [code, { ...sto, lis: OCTOBER_LIS[code]! }])
);

export function masterForDate(date?: string): Record<string, StoMaster> {
  return date && date < LIS_EFFECTIVE_FROM ? OCTOBER_MASTER : MASTER;
}

export function masterForStoredBranch(branch: Branch, lis: number, date: string): Record<string, StoMaster> {
  const dated = masterForDate(date);
  const total = (master: Record<string, StoMaster>): number => Object.values(master)
    .filter(sto => sto.branch === branch).reduce((sum, sto) => sum + sto.lis, 0);
  if (total(dated) === lis) return dated;
  // Older snapshots have a branch LIS but no per-STO LIS. Match their saved basis.
  return [OCTOBER_MASTER, MASTER].find(master => total(master) === lis) ?? dated;
}

// STO di luar 4 branch yang dikenal dashboard: dikecualikan, bukan dianggap error.
export const EXCLUDED_STOS = new Set(
  'ABO,PAO,BUL,MSH,NIR,NML,NMR,SPR,WHA,DOB,LRA,SML,TUA,TIA,GTL,LBT,TLG,ISM,KWD,MRS,MRA,AGT,BAD,MRK,TMR,SNI,SRM,SMI,WAM,ABE,WAE,JAP,JPA,JPB,BIA,SRU,KUK,BAH,BIT,AMD,BEO,HLS,KAU,TAG,THN,AMR,BOR,KTG,LOL,MOL,TUT,LBH,MGL,SNN,SSI,MDO,LAN,TDN,TMH,PIK,JLL,SFI,TNT,GLL,MTA,TOB,BGI,BUT,LWU,PGM,APN,BKU,KOL,DGL,PLA,PLB,TWL,PLC,KOR,MOT,BUO,PGI,TLY,TNB,TOL,PSO,TEN,TBG,TIM,NAB,FFA,KIN,BTI,MWR,RSK,WMR,SON,TMB,PKA,GSA,BAM,BRU,KTB,MGG,KJN,PTG,MKM,BTK,LAB,LIK,PNJ,KRO,TNG,SKU,MJW,SEP,AGN,SAN,SBR,SGK,PAA,SMR,SEM,PLL,MLA,BLN,KBG,TGG,TSN,KOB,STT,MBD,BOT,LMP,LKT,TMD,LOB,TRK,LNN,TLA,TBY,MLN,TPE,SNY,TSL,JWT,TRD,NNK,TAJ,BBR,MRB,MTP,BJM,KYG,BLC,KIP,KPL,PGT,SER,STI,TRJ,BTB,LUL,PLE,TKI,AMT,BRI,KDG,NEG,PGN,RTA,TJL,GMB,ULI,PLK,PYM,KKP,KRI,AMP,SUA,KMI,SAI,HNU,SAD,KSO,PRC,KPB,PPS,KKY,PEA,KKN,PBU,BNT,MTW,TML,LMD,STA,PTK,SAO,SRY,JAW,SRD,SEI,KTP,BKY,SNW,KKU,NPN,SMB,MPW,SGU,TBA,SED,NGG,SPY,KWN,STG,BDO,SDR,BIG,RBA,ANJ,PUT,PMK'.split(',')
);
