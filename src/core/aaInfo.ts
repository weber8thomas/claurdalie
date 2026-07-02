// Amino-acid metadata for tooltips (name, 3-letter code, property group).

export interface AAInfo {
  name: string
  three: string
  group: string
}

export const AA_INFO: Record<string, AAInfo> = {
  A: { name: 'Alanine', three: 'Ala', group: 'Hydrophobic' },
  R: { name: 'Arginine', three: 'Arg', group: 'Positive (basic)' },
  N: { name: 'Asparagine', three: 'Asn', group: 'Polar' },
  D: { name: 'Aspartate', three: 'Asp', group: 'Negative (acidic)' },
  C: { name: 'Cysteine', three: 'Cys', group: 'Special (thiol)' },
  E: { name: 'Glutamate', three: 'Glu', group: 'Negative (acidic)' },
  Q: { name: 'Glutamine', three: 'Gln', group: 'Polar' },
  G: { name: 'Glycine', three: 'Gly', group: 'Special (flexible)' },
  H: { name: 'Histidine', three: 'His', group: 'Positive / aromatic' },
  I: { name: 'Isoleucine', three: 'Ile', group: 'Hydrophobic (aliphatic)' },
  L: { name: 'Leucine', three: 'Leu', group: 'Hydrophobic (aliphatic)' },
  K: { name: 'Lysine', three: 'Lys', group: 'Positive (basic)' },
  M: { name: 'Methionine', three: 'Met', group: 'Hydrophobic' },
  F: { name: 'Phenylalanine', three: 'Phe', group: 'Aromatic' },
  P: { name: 'Proline', three: 'Pro', group: 'Special (rigid)' },
  S: { name: 'Serine', three: 'Ser', group: 'Polar' },
  T: { name: 'Threonine', three: 'Thr', group: 'Polar' },
  W: { name: 'Tryptophan', three: 'Trp', group: 'Aromatic' },
  Y: { name: 'Tyrosine', three: 'Tyr', group: 'Aromatic' },
  V: { name: 'Valine', three: 'Val', group: 'Hydrophobic (aliphatic)' },
  B: { name: 'Asx (Asn/Asp)', three: 'Asx', group: 'Ambiguous' },
  Z: { name: 'Glx (Gln/Glu)', three: 'Glx', group: 'Ambiguous' },
  X: { name: 'Any residue', three: 'Xaa', group: 'Unknown' },
  U: { name: 'Selenocysteine', three: 'Sec', group: 'Special' },
  O: { name: 'Pyrrolysine', three: 'Pyl', group: 'Special' },
  '*': { name: 'Stop', three: '*', group: '—' },
  '-': { name: 'Gap', three: '—', group: 'Alignment gap' },
}
