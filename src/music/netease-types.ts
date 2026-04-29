/** Response types for NeteaseCloudMusicApi */

export interface NeteaseArtist {
  id?: number;
  name: string;
}

export interface NeteaseAlbum {
  id?: number;
  name?: string;
  picUrl?: string;
}

export interface NeteaseSong {
  id: number;
  name: string;
  ar?: NeteaseArtist[];
  artists?: NeteaseArtist[];
  al?: NeteaseAlbum;
  album?: NeteaseAlbum;
  dt?: number;
  duration?: number;
}

export interface NeteasePlaylist {
  id: number;
  name: string;
  coverImgUrl?: string;
  trackCount?: number;
  picUrl?: string;
}

export interface NeteaseSongUrlResponse {
  data?: Array<{ url?: string | null }>;
}

export interface NeteaseSongDetailResponse {
  songs?: NeteaseSong[];
}

export interface NeteaseSearchSongResponse {
  result?: {
    songs?: NeteaseSong[];
  };
}

export interface NeteaseSearchPlaylistResponse {
  result?: {
    playlists?: NeteasePlaylist[];
  };
}

export interface NeteasePersonalizedResponse {
  result?: NeteasePlaylist[];
}

export interface NeteasePlaylistTrackResponse {
  songs?: NeteaseSong[];
}

export interface NeteaseAlbumResponse {
  songs?: NeteaseSong[];
}

export interface NeteaseLyricResponse {
  lrc?: { lyric?: string };
  tlyric?: { lyric?: string };
}

export interface NeteasePersonalFmResponse {
  data?: NeteaseSong[];
}

export interface NeteaseDailyRecommendResponse {
  data?: {
    dailySongs?: NeteaseSong[];
  };
}

export interface NeteaseQrKeyResponse {
  data?: { unikey?: string };
}

export interface NeteaseQrCreateResponse {
  data?: { qrurl?: string; qrimg?: string };
}

export interface NeteaseQrCheckResponse {
  code: number;
  cookie?: string;
}

export interface NeteaseLoginStatusResponse {
  data?: {
    profile?: {
      nickname?: string;
      avatarUrl?: string;
      userId?: number;
    };
  };
}

export interface NeteaseCaptchaResponse {
  code?: number;
  cookie?: string;
}

export interface NeteaseUserPlaylistResponse {
  playlist?: NeteasePlaylist[];
}

export interface NeteasePlaylistDetailResponse {
  playlist?: {
    id?: number;
    name?: string;
    description?: string;
    coverImgUrl?: string;
    trackCount?: number;
  };
}
