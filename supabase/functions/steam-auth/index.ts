// Edge Function steam-auth — STUB (A6 implementa quando existir o AppID). Não chama a Steam.
//
// Fluxo de produção (docs/CONTRACTS.md §8, DECISOES.md):
//  1. O cliente Electron chama SteamUser.GetAuthTicketForWebApi("vif-auth") e manda
//     POST /functions/v1/steam-auth  { "ticket": "<hex>" }.
//  2. Esta função valida o ticket na Steam Web API, com a chave de publisher guardada nos SEGREDOS
//     (STEAM_PUBLISHER_KEY, STEAM_APP_ID — nunca no cliente):
//       GET https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/
//           ?key=…&appid=…&ticket=…&identity=vif-auth            → steamid
//       GET https://partner.steam-api.com/ISteamUser/CheckAppOwnership/v4/
//           ?key=…&steamid=…&appid=…                              → ownsapp (o jogo é pago)
//       GET https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=…&steamids=…  → nickname
//  3. Acha ou cria o usuário do Supabase ligado ao steamid (auth.admin com SUPABASE_SERVICE_ROLE_KEY),
//     gravando em raw_user_meta_data { steamid, nickname, timezone } — o gatilho do banco cria
//     perfil, carteira, fazenda e kit inicial.
//  4. Devolve uma sessão do Supabase (access_token + refresh_token) para o cliente usar no supabase-js.
//
// Em desenvolvimento o jogo usa o login anônimo do Supabase (ou a API falsa) e não chama esta função.

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  let ticket: unknown;
  try {
    ticket = ((await req.json()) as { ticket?: unknown }).ticket;
  } catch {
    return json(400, { error: 'INVALID_INPUT' });
  }
  if (typeof ticket !== 'string' || !/^[0-9a-fA-F]{16,4096}$/.test(ticket)) {
    return json(400, { error: 'INVALID_INPUT' });
  }
  if (!Deno.env.get('STEAM_PUBLISHER_KEY') || !Deno.env.get('STEAM_APP_ID')) {
    return json(503, { error: 'STEAM_UNAVAILABLE', message: 'Steam ainda não configurada' });
  }
  // TODO(A6): passos 2–4 acima.
  return json(501, {
    error: 'NOT_IMPLEMENTED',
    message: 'login pela Steam ainda não implementado',
  });
});
