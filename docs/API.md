# HTTP API и MCP

Сервер слушает `127.0.0.1:4317`. Запросы с чужим `Host`/`Origin` получают `403`, `POST` принимает только `application/json`. Ошибки приходят как `{ "error": "...", "code": "..." }`.

## Эндпоинты
| Метод | Путь | Описание |
| --- | --- | --- |
| GET | `/api/project` | текущий проект |
| POST | `/api/op` | `{ "op": "...", "args": { ... } }` → `{ project, result }` |
| POST | `/api/import` | `{ "path": "/abs/file.mp4" }` |
| GET | `/api/browse?dir=` | видеофайлы в папке |
| GET | `/api/events` | SSE: события `project`, `render-progress` и `transcribe-progress` |
| POST | `/api/render` | `{ output, width?, height?, fps?, crf?, preset?, audioBitrate?, loudnorm? }` |
| POST | `/api/render/cancel` | отмена экспорта |
| POST | `/api/preview` | прокси 540×960; результат на `/preview.mp4` |
| GET | `/media/:id` | исходник с поддержкой Range |

## Операции `/api/op` и MCP-тулы
| `op` | MCP-тул | Что делает |
| --- | --- | --- |
| `getProject` | `get_project` | проект целиком |
| `importMedia` | `import_media` | добавляет файл в библиотеку |
| `addClip` | `add_clip` | клип на дорожку (`track`: `main`, `overlay`…`overlay10`) |
| `split`, `splitAt` | `split` | разрез клипа или по времени таймлайна |
| `trim` | `trim` | границы клипа внутри исходника |
| `remove`, `removeClips` | `remove_clip`, `remove_clips` | удаление (на main со сдвигом) |
| `move` | `move_clip` | порядок на main |
| `moveClipToTrack` | `move_clip_to_track` | перенос между дорожками |
| `addOverlayTrack`, `removeOverlayTrack` | `add_overlay_track`, `remove_overlay_track` | управление оверлей-дорожками |
| `setClip`, `setClips` | `set_clip`, `set_clips` | scale, x, y, region, speed, vfilters, afilters, volume, muted, fadeIn, fadeOut, name, start |
| `detectSilence`, `removeSilence` | `detect_silence`, `remove_silence` | поиск и вырезание пауз |
| `setCanvas` | `set_canvas` | размер и fps холста |
| `addText`, `setText`, `removeText`, `setStyle` | `add_text`, `set_text`, `remove_text`, `set_style` | подписи и стили |
| `importSubtitles`, `importTranscript` | `import_subtitles`, `import_transcript` | `.srt`/`.ass` и слова транскрипции |
| `speechState` | `speech_status` | установлено ли распознавание речи |
| `transcribe`, `cancelTranscribe` | `transcribe`, `cancel_transcribe` | расшифровка речи (whisper.cpp), прогресс по SSE `transcribe-progress` |
| `getTranscript`, `findInTranscript`, `findRepeats` | `get_transcript`, `find_in_transcript`, `find_repeats` | текст фразами, поиск фраз, повторные дубли |
| `cutSourceRange`, `subtitlesFromTranscript` | `cut_source_range`, `subtitles_from_transcript` | вырезать интервал исходника, подписи из расшифровки |
| `listProjects`, `newProject`, `loadProject`, `saveProjectAs` | `list_projects`, `new_project`, `load_project`, `save_project_as` | проекты |
| `undo`, `redo` | `undo`, `redo` | история |
| `render`, `cancelRender`, `preview` | `render`, `cancel_render`, `preview` | экспорт |

Поля `setClip` и `setClips`: `speed` (0,25–4, 1 — как в исходнике; клип на таймлайне становится короче или длиннее), `vfilters` и `afilters` (одна цепочка фильтров ffmpeg для видео и звука клипа, `null` очищает; без меток, без фильтров, меняющих длительность),  `scale` (1 — cover холста или области), `x` и `y` (сдвиг от центра в долях холста, а при `region` — в долях области), `volume` от 0 до 2, `muted`, `fadeIn`, `fadeOut` (секунды), `name`, `start` (только оверлей). `region`: `null` — весь кадр; `{x, y, w, h}` — доля холста от левого верхнего угла, клип закрывает только её. Верхняя половина `{x:0,y:0,w:1,h:0.5}`, нижняя `{x:0,y:0.5,w:1,h:0.5}`. `w` и `h` не меньше 0.05, `x+w` и `y+h` не больше 1.

## Модель данных
```json
{
  "version": 2,
  "name": "reel",
  "canvas": { "width": 1080, "height": 1920, "fps": 30 },
  "media": [{ "id": "m1", "path": "/abs/a.mp4", "duration": 12.5, "width": 1080, "height": 1920, "hasAudio": true }],
  "tracks": [
    { "id": "main", "kind": "ripple", "clips": [{ "id": "c1", "mediaId": "m1", "in": 0, "out": 4.2, "region": null }] },
    { "id": "overlay", "kind": "free", "clips": [] }
  ],
  "texts": [{ "id": "t1", "start": 1.2, "end": 3, "text": "...", "style": "sub" }],
  "styles": { "sub": { "font": "JetBrains Mono", "weight": 700, "size": 62, "color": "#F3E9DC" } }
}
```
Время везде в секундах. Номер оверлей-дорожки задаёт z-порядок: больший номер рисуется поверх меньшего.
