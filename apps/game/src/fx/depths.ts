// Profundidades dos efeitos (entre o overhead 5000 e a depuração 10000; ver DEPTH em core/constants).

export const FX_DEPTH = {
  /** Tinta de iluminação (MULTIPLY) sobre o mundo. */
  light: 5_500,
  /** Lanterna/brilhos que devem "acender" por cima da noite. */
  glow: 5_550,
  fireflies: 5_600,
  rain: 5_700,
  /** Textos flutuantes e dicas: sempre legíveis. */
  floating: 7_000,
} as const;
