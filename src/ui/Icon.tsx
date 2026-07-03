// Minimal stroke icon set (Feather-style) so the UI uses consistent line icons
// instead of emoji. 24×24 viewBox, currentColor stroke.

const PATHS: Record<string, string[]> = {
  import: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'],
  export: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z'],
  undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
  redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13'],
  palette: [
    'M12 21a9 9 0 1 1 0-18c4.97 0 9 3.58 9 8 0 2.5-2 3.5-3.5 3.5H16a2 2 0 0 0-1.6 3.2 1.4 1.4 0 0 1-1.1 2.3z',
  ],
  map: ['M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3z', 'M9 3v15', 'M15 6v15'],
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  sun: [
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
    'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4',
    'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4',
  ],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3', 'M12 17h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16v-4', 'M12 8h.01'],
  database: [
    'M12 8c4.42 0 8-1.34 8-3s-3.58-3-8-3-8 1.34-8 3 3.58 3 8 3z',
    'M20 5v6c0 1.66-3.58 3-8 3s-8-1.34-8-3V5',
    'M20 11v6c0 1.66-3.58 3-8 3s-8-1.34-8-3v-6',
  ],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  cube: ['M21 7.5 12 3 3 7.5v9L12 21l9-4.5v-9z', 'M3 7.5 12 12l9-4.5', 'M12 12v9'],
  chart: ['M3 3v18h18', 'M7 16v-5', 'M12 16V8', 'M17 16v-8'],
  group: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  tree: ['M12 3v6', 'M12 15v6', 'M6 21v-4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4', 'M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M6 24a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'M18 24a2 2 0 1 0 0-4 2 2 0 0 0 0 4'],
  align: ['M3 6h18', 'M3 12h11', 'M3 18h15'],
  identity: ['M4 7h16', 'M4 12h16', 'M4 17h16', 'M8 4v16'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  barcode: ['M4 5v14', 'M7 5v14', 'M10 5v14', 'M13 5v14', 'M16 5v14', 'M19 5v14'],
  eye: ['M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  'eye-off': ['M17.9 17.9A10.6 10.6 0 0 1 12 19c-7 0-11-7-11-7a19 19 0 0 1 5.1-5.9', 'M9.9 4.2A10.9 10.9 0 0 1 12 4c7 0 11 7 11 7a19 19 0 0 1-2.2 3.2', 'M1 1l22 22', 'M9.5 9.5a3 3 0 0 0 4.2 4.2'],
}

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  const paths = PATHS[name] ?? []
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
