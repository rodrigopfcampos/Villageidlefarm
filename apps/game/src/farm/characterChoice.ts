// Escolha do personagem (fazendeiro/fazendeira), salva só localmente por enquanto.
// Quando houver campo no perfil do servidor, trocar por ele (ver pedido de contrato).

import { PLAYER_CHARACTERS, type PlayerCharacter } from '../scenes/Preload';

const KEY = 'vif.character';

export function loadCharacter(): PlayerCharacter | null {
  try {
    const v = localStorage.getItem(KEY);
    return (PLAYER_CHARACTERS as readonly string[]).includes(v ?? '')
      ? (v as PlayerCharacter)
      : null;
  } catch {
    return null;
  }
}

export function saveCharacter(c: PlayerCharacter): void {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // modo privado/armazenamento bloqueado: vale só nesta sessão
  }
}
