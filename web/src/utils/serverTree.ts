export interface ChannelNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  children: ChannelNode[];
  clients: ClientNode[];
  isSpacer: boolean;
}

export interface ClientNode {
  id: string;
  nickname: string;
  uid: string;
  channelId: string;
  isBot: boolean;
  serverGroups: string[];
  type: number;
}

export interface ServerTreeData {
  channels: {
    id: string;
    parentId: string | null;
    name: string;
    description: string;
  }[];
  clients: {
    id: string;
    nickname: string;
    uid: string;
    channelId: string;
    isBot: boolean;
    serverGroups: string[];
    type: number;
  }[];
  botChannelId: string;
  botClientId: string;
}

export function buildChannelTree(data: ServerTreeData): ChannelNode[] {
  const map = new Map<string, ChannelNode>();
  data.channels.forEach((c) => {
    const isSpacer = /^\[.*spacer/i.test(c.name) || /^[cr]spacer/i.test(c.name);
    map.set(c.id, {
      ...c,
      children: [],
      clients: [],
      isSpacer,
    });
  });

  data.clients.forEach((c) => {
    const ch = map.get(c.channelId);
    if (ch) ch.clients.push(c);
  });

  const roots: ChannelNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort channels by name for stable ordering
  roots.sort((a, b) => a.name.localeCompare(b.name));
  map.forEach((node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  });

  return roots;
}
