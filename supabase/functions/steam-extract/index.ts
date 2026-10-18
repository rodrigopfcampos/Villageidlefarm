// Edge Function steam-extract — STUB (A6 implementa). Não chama a Steam.
//
// O banco já faz a parte do jogo: a RPC extraction_request confere cota (7 h deslizantes, 1 ou 4 com VIP),
// nível e item, tira o item do inventário (escrow) e grava a retirada como 'pending'.
// Esta função, rodando com a service role (agendador do Supabase ou webhook do banco), vai:
//  1. Ler as retiradas 'pending' (select em public.extractions where status = 'pending').
//  2. Para cada uma, criar o item no inventário Steam do jogador pelo Steam Inventory Service,
//     com a chave de publisher dos SEGREDOS (STEAM_PUBLISHER_KEY, STEAM_APP_ID):
//       POST https://partner.steam-api.com/IInventoryService/AddItem/v1/
//            key, appid, steamid, itemdefid[0] (itemdef ligado ao item_id do jogo), notify=1
//     O steamid vem do usuário (raw_user_meta_data.steamid, gravado pelo steam-auth).
//  3. Chamar a RPC public.extraction_complete(extraction_id, ok, steam_item_id, error_message):
//       ok = true  → 'granted' + item em public.steam_items + aviso extraction_granted (Realtime);
//       ok = false → 'failed' + devolve o item do escrow + aviso extraction_failed.
//     A RPC é idempotente (só mexe em 'pending') e só a service role pode chamá-la.
//  4. Volta (Steam → jogo): ao ler o inventário Steam do jogador (IInventoryService/GetInventory) e
//     consumir o item (ConsumeItem), registrar o id em public.steam_items; a RPC steam_return_sync só
//     credita ids que estejam lá como 'in_steam' e sejam do jogador.

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

Deno.serve(() => {
  const configured = Boolean(Deno.env.get('STEAM_PUBLISHER_KEY') && Deno.env.get('STEAM_APP_ID'));
  return new Response(
    JSON.stringify({
      error: configured ? 'NOT_IMPLEMENTED' : 'STEAM_UNAVAILABLE',
      message: 'concessão na Steam ainda não implementada; as retiradas ficam pending',
    }),
    { status: configured ? 501 : 503, headers: { 'Content-Type': 'application/json' } },
  );
});
