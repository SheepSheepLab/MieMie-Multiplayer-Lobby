/** Multiplayer identity and output contracts. */
export function validatePlayers(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw new Error('联机需要 2～4 名玩家');
  }
  const ids = new Set();
  const seats = new Set();
  for (const player of players) {
    if (!player.id || ids.has(player.id) || !Number.isInteger(player.seat) ||
        player.seat < 0 || player.seat > 3 || seats.has(player.seat) ||
        typeof player.name !== 'string' || !player.name.trim() ||
        typeof player.description !== 'string') throw new Error('玩家身份无效或重复');
    ids.add(player.id);
    seats.add(player.seat);
  }
  if (!seats.has(0)) throw new Error('缺少房主席位');
  return [...players].sort((a, b) => a.seat - b.seat);
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function participantContext(players) {
  const ordered = validatePlayers(players);
  return {
    user: ordered.map(p => `${p.name}（user${p.seat}）`).join('、'),
    persona: ordered.map(p => `<user${p.seat}>\n姓名：${escapeXml(p.name)}\n${escapeXml(p.description)}\n</user${p.seat}>`).join('\n'),
    statusInstruction: '共享剧情只输出一次。为每个参与席位分别输出完整状态栏，使用以下包裹格式，每个席位恰好一次：\n' +
      ordered.map(p => `<user${p.seat}><status>该角色的完整状态栏</status></user${p.seat}>`).join('\n'),
  };
}

export function splitReply(reply, players) {
  const ordered = validatePlayers(players);
  const expected = new Set(ordered.map(p => p.seat));
  const statuses = new Map();
  const pattern = /<user([0-3])>\s*(<status>[\s\S]*?<\/status>)\s*<\/user\1>/g;
  const story = reply.replace(pattern, (block, number, status) => {
    const seat = Number(number);
    if (!expected.has(seat) || statuses.has(seat)) throw new Error('状态栏席位错误或重复');
    if (/<\/?user\d|<status>/i.test(status.slice(8, -9))) throw new Error('状态栏嵌套无效');
    statuses.set(seat, status);
    return '';
  });
  if (statuses.size !== ordered.length || /<\/?(?:status|user\d)(?:\s|>)/i.test(story)) {
    throw new Error('状态栏数量或格式不完整，请房主重试');
  }
  return {
    story: story.trim(),
    players: ordered.map(p => ({ playerId: p.id, seat: p.seat, status: statuses.get(p.seat),
      message: `${story.trim()}\n\n${statuses.get(p.seat)}` })),
  };
}
