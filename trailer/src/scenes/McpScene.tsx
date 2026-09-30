import React from 'react'
import { AbsoluteFill, interpolate, spring } from 'remotion'
import { COPY, MCP, visibleChars } from '../timeline'
import { C, EASE, FONT } from '../theme'
import captures from '../data/captures.json'
import demo from '../data/demo-chart.json'
import { AgentChat, linkChipCenter, type ChatItem, type ChatMetrics } from '../components/AgentChat'
import { BrowserWindow } from '../components/BrowserWindow'
import { CaptureView, sourceFrameFor, type CaptureCamera } from '../components/CaptureView'
import { Cursor, cursorAt } from '../components/Cursor'
import { Caption, Scrim, cameraPath, caretOpacity, clamp01, ease, useAbsFrame, useLayout } from '../components/util'

type Cap = (typeof captures)['landscape']

const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })

/** Camera that frames a region of the capture (the pane has the capture's aspect ratio). */
function fitRegion(capture: { w: number; h: number }, r: { left: number; top: number; right: number; bottom: number }): CaptureCamera {
  return {
    zoom: Math.min(capture.w / (r.right - r.left), capture.h / (r.bottom - r.top)),
    fx: (r.left + r.right) / 2,
    fy: (r.top + r.bottom) / 2,
  }
}

function chatItems(cap: Cap): ChatItem[] {
  const created = cap.tool.createText.split('\n')
  const shortEdit = `${cap.url}#edit=${cap.editTokenPreview}`
  const [addNode, retarget, addEdge] = cap.tool.updateOperations as unknown as [
    { node: { id: string; label: string } },
    { id: string; changes: { target: string } },
    { edge: { source: string; target: string } },
  ]
  return [
    { kind: 'user', at: MCP.user1, text: demo.createPrompt },
    {
      kind: 'tool',
      at: MCP.toolCreate,
      name: 'create_flowchart',
      args: [
        { at: MCP.toolCreateArgs[0], text: `title: "${demo.title}"` },
        { at: MCP.toolCreateArgs[1], text: `direction: "${cap.direction}"` },
        { at: MCP.toolCreateArgs[2], text: `nodes: [{ id: "visit", type: "step", … }, … ${demo.nodes.length} total]` },
        { at: MCP.toolCreateArgs[3], text: `edges: [{ source: "visit", target: "signup" }, … ${demo.edges.length} total]` },
      ],
      doneAt: MCP.toolCreateDone,
      result: `${created[0]}\n${created[2]}\n${shortEdit}`,
    },
    {
      kind: 'assistant',
      at: MCP.assistantLink,
      text: 'Here’s your flowchart. Open it to view and edit:',
      link: `${cap.url}#edit=…`,
    },
    { kind: 'user', at: MCP.send + 2, text: COPY.mcpUpdatePrompt },
    {
      kind: 'tool',
      at: MCP.toolGet,
      name: 'get_flowchart',
      args: [],
      doneAt: MCP.toolGetDone,
      result: `version ${cap.tool.getVersion}`,
      compact: true,
    },
    {
      kind: 'tool',
      at: MCP.toolUpdate,
      name: 'update_flowchart',
      args: [
        { at: MCP.toolUpdateArgs[0], text: `expectedVersion: ${cap.tool.getVersion}` },
        { at: MCP.toolUpdateArgs[1], text: `add_node     { id: "${addNode.node.id}", label: "${addNode.node.label}" }` },
        { at: MCP.toolUpdateArgs[2], text: `update_edge  "${retarget.id}" { target: "${retarget.changes.target}" }` },
        { at: MCP.toolUpdateArgs[3], text: `add_edge     { source: "${addEdge.edge.source}", target: "${addEdge.edge.target}" }` },
      ],
      doneAt: MCP.toolUpdateDone,
      result: `version: ${cap.tool.updateVersion}\nchanges: ${cap.tool.changes.join('; ')}`,
    },
    { kind: 'assistant', at: MCP.toolUpdateDone + 36, text: 'Done. It’s already in your open tab.' },
  ]
}

const L = {
  landscape: {
    chat: { w: 620, h: 742, xA: 650, xB: 72, y: 134 },
    metrics: { width: 620, pad: 22, text: 18, mono: 13.5, gap: 14 } satisfies ChatMetrics,
    browser: { x: 724, y: 134, w: 1124, bar: 40 },
    captionBottom: 64,
    captionSize: 50,
  },
  portrait: {
    chat: { w: 960, h: 1240, xA: 60, xB: 60, y: 300 },
    metrics: { width: 960, pad: 34, text: 28, mono: 20.5, gap: 20 } satisfies ChatMetrics,
    browser: { x: 40, y: 96, w: 1000, bar: 56 },
    captionBottom: 150,
    captionSize: 62,
  },
}

export const McpScene: React.FC<{ from: number }> = ({ from }) => {
  const frame = useAbsFrame(from)
  const { H, portrait } = useLayout()
  const cap: Cap = portrait ? (captures.portrait as unknown as Cap) : captures.landscape
  const lay = portrait ? L.portrait : L.landscape
  const fps = 60
  const capture = { w: cap.viewport.width, h: cap.viewport.height }
  const contentH = (lay.browser.w * capture.h) / capture.w

  // --- Chat --------------------------------------------------------------------------
  const typingCount = visibleChars(MCP.user2Typing, frame)
  const draft = COPY.mcpUpdatePrompt.slice(0, typingCount)
  const composerText = frame >= MCP.send ? '' : draft
  const lastKey = MCP.user2Typing[MCP.user2Typing.length - 1]
  const chatIn = spring({ frame: frame - MCP.chatIn, fps, config: { damping: 24, stiffness: 140 } })

  // Landscape: the chat slides left to make room for the browser.
  // Portrait: the browser rises over the chat; the chat returns as a sheet for the second ask.
  const slide = ease(frame, MCP.linkClick + 2, MCP.linkClick + 44, EASE.inOut)
  let chatX = interpolate(slide, [0, 1], [lay.chat.xA, lay.chat.xB])
  let chatY = lay.chat.y + (1 - chatIn) * 30
  let chatScale = 1
  let chatOpacity = clamp01(chatIn * 1.4)
  let chatZ = 2
  if (portrait) {
    chatX = lay.chat.xA
    const recede = ease(frame, MCP.linkClick + 2, MCP.linkClick + 40, EASE.inOut)
    const sheetUp = ease(frame, MCP.user2Typing[0] - 26, MCP.user2Typing[0] - 2, EASE.out)
    const sheetDown = ease(frame, MCP.toolUpdateDone + 44, MCP.toolUpdateDone + 70, EASE.in)
    chatScale = 1 - 0.06 * recede
    chatOpacity *= 1 - 0.65 * recede
    chatZ = sheetUp > 0 ? 3 : 1
    if (sheetUp > 0) {
      chatScale = 1
      chatOpacity = 1
      chatY = interpolate(sheetUp - sheetDown, [0, 1], [H + 40, H - lay.chat.h * 0.62])
    }
  }
  const linkHover = ease(frame, MCP.linkClick - 14, MCP.linkClick - 4)

  // --- Browser -----------------------------------------------------------------------
  const browserIn = spring({ frame: frame - MCP.browserIn, fps, config: { damping: 22, stiffness: 120, mass: 1 } })
  const loaded = frame >= MCP.pageLoaded
  const loadFade = ease(frame, MCP.pageLoaded, MCP.pageLoaded + 8, EASE.standard)
  const updateSrc = sourceFrameFor(frame, MCP.updateLands, cap.update.changeFrame, cap.update.frames)

  // The agent's step lands in the slot between "Payment succeeded?" and the next node; the
  // camera settles on that slot just before it arrives, then pulls back to a two-shot of the
  // new step and the "Updated by AI agent" badge.
  const stepBox = cap.update.nodes.welcome
  const step = center(stepBox)
  const badge = cap.update.badge
  const toolbar = cap.open.toolbar
  const full = { zoom: 1, fx: capture.w / 2, fy: capture.h / 2 }
  const nodeFocus = portrait ? { zoom: 2.25, fx: step.x, fy: step.y } : { zoom: 2.35, fx: step.x, fy: step.y }
  // Landscape keeps the whole toolbar in frame (the chart simply runs off the right edge).
  // Portrait shows the whole app: the badge already reads at that scale, and a tighter shot
  // would put the new step under the caption.
  const twoShot = portrait
    ? { zoom: 1.02, fx: capture.w / 2, fy: capture.h / 2 }
    : fitRegion(capture, {
        left: Math.max(0, badge.x - 16),
        top: 0,
        right: Math.max(stepBox.x + stepBox.width + 70, toolbar.x + toolbar.width + 35),
        bottom: stepBox.y + stepBox.height + 30,
      })
  const camera: CaptureCamera = cameraPath(frame, [
    [MCP.browserIn, full],
    [MCP.pushInStart, { ...full, zoom: 1.04 }],
    [MCP.updateLands - 6, nodeFocus],
    [MCP.updateLands + 50, { ...nodeFocus, fx: nodeFocus.fx + (portrait ? 0 : 20), fy: nodeFocus.fy + (portrait ? 24 : 0) }],
    [MCP.pullBackStart, twoShot],
    [MCP.pullBackStart + 110, { ...twoShot, zoom: twoShot.zoom * 1.03 }],
    [MCP.clientsIn - 6, full],
  ])

  const url =
    frame < MCP.fragmentDropped ? (
      <span>
        <span style={{ color: 'rgba(231, 236, 235, 0.92)' }}>flowchart.zeroclickdev.ai</span>
        {`/f/${cap.id}#edit=${cap.editTokenPreview}`}
      </span>
    ) : (
      <span>
        <span style={{ color: 'rgba(231, 236, 235, 0.92)' }}>flowchart.zeroclickdev.ai</span>
        {`/f/${cap.id}`}
      </span>
    )

  // --- Cursor ------------------------------------------------------------------------
  const items = chatItems(cap)
  const chip = linkChipCenter(items, lay.metrics, lay.chat.h, MCP.linkClick - 8, 2)
  const linkX = lay.chat.xA + chip.x
  const linkY = lay.chat.y + chip.y
  const cursorKeys = [
    { frame: MCP.cursorIn, x: linkX + (portrait ? 420 : 330), y: linkY + (portrait ? 300 : 180) },
    { frame: MCP.linkClick - 8, x: linkX, y: linkY },
    { frame: MCP.linkClick + 30, x: linkX + 40, y: linkY + 40 },
  ]
  const cur = cursorAt(frame, cursorKeys)
  const cursorOpacity = ease(frame, MCP.cursorIn, MCP.cursorIn + 10) * (1 - ease(frame, MCP.linkClick + 12, MCP.linkClick + 28))

  const introOut = MCP.toolCreateDone + 20
  const captionOut = MCP.clientsIn - 12
  const sceneOut = ease(frame, from + 960 - 16, from + 960, EASE.in)

  const chat = (
    <div
      style={{
        position: 'absolute',
        left: chatX,
        top: chatY,
        transform: `scale(${chatScale})`,
        transformOrigin: '50% 30%',
        opacity: chatOpacity,
        zIndex: chatZ,
      }}
    >
      <AgentChat
        frame={frame}
        items={items}
        metrics={lay.metrics}
        height={lay.chat.h}
        clientName="Your AI agent"
        endpoint={COPY.mcpEndpoint}
        composer={{ text: composerText, caret: caretOpacity(frame, lastKey) > 0.5 && frame < MCP.send, sendAt: MCP.send }}
        highlightLink={linkHover * (1 - ease(frame, MCP.linkClick + 10, MCP.linkClick + 20))}
      />
    </div>
  )

  const browserY = portrait ? interpolate(browserIn, [0, 1], [H + 60, lay.browser.y]) : lay.browser.y + (1 - browserIn) * 40
  const browser = frame >= MCP.browserIn && (
    <div
      style={{
        position: 'absolute',
        left: lay.browser.x + (portrait ? 0 : (1 - browserIn) * 80),
        top: browserY,
        opacity: portrait ? 1 : clamp01(browserIn * 1.5),
        transform: `scale(${portrait ? 1 : 0.96 + 0.04 * browserIn})`,
        transformOrigin: '0% 50%',
        zIndex: 2,
      }}
    >
      <BrowserWindow width={lay.browser.w} contentHeight={contentH} barHeight={lay.browser.bar} url={url}>
        <CaptureView
          width={lay.browser.w}
          height={contentH}
          capture={capture}
          camera={camera}
          source={loaded ? { kind: 'video', src: cap.update.file, sourceFrame: updateSrc } : { kind: 'image', src: `captures/${portrait ? 'portrait' : 'landscape'}/open-loading.png` }}
        />
        {loaded && loadFade < 1 && (
          <div style={{ position: 'absolute', inset: 0, opacity: 1 - loadFade }}>
            <CaptureView width={lay.browser.w} height={contentH} capture={capture} camera={camera} source={{ kind: 'image', src: `captures/${portrait ? 'portrait' : 'landscape'}/open-loading.png` }} />
          </div>
        )}
      </BrowserWindow>
    </div>
  )

  return (
    <AbsoluteFill style={{ background: C.bg, opacity: 1 - sceneOut }}>
      {portrait ? (
        <>
          {chatZ < 3 && chat}
          {browser}
          {chatZ === 3 && chat}
        </>
      ) : (
        <>
          {browser}
          {chat}
        </>
      )}
      {cursorOpacity > 0 && <Cursor x={cur.x} y={cur.y} frame={frame} clicks={[MCP.linkClick]} opacity={cursorOpacity} scale={portrait ? 1.35 : 1} />}
      <Scrim size={portrait ? 460 : 250} opacity={Math.max(ease(frame, MCP.captionIn - 16, MCP.captionIn + 6), 1 - ease(frame, introOut - 10, introOut)) * 0.95} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: lay.captionBottom, display: 'flex', justifyContent: 'center', zIndex: 5 }}>
        {frame < introOut + 2 && <Caption lines={[COPY.mcpIntro]} frame={frame} start={MCP.chatIn + 10} end={introOut} size={lay.captionSize * 0.8} align="center" />}
        {frame >= MCP.captionIn - 2 && frame < captionOut + 2 && (
          <Caption lines={[COPY.mcpCaption]} frame={frame} start={MCP.captionIn} end={captionOut} size={lay.captionSize} align="center" />
        )}
        {frame >= MCP.clientsIn - 2 && <ClientsLine frame={frame} size={lay.captionSize} portrait={portrait} />}
      </div>
    </AbsoluteFill>
  )
}

const ClientsLine: React.FC<{ frame: number; size: number; portrait: boolean }> = ({ frame, size, portrait }) => {
  const k = ease(frame, MCP.clientsIn, MCP.clientsIn + 24)
  return (
    <div style={{ textAlign: 'center', fontFamily: FONT.sans }}>
      <Caption lines={[COPY.mcpAny]} frame={frame} start={MCP.clientsIn} size={size} align="center" />
      <div
        style={{
          marginTop: size * 0.34,
          display: 'flex',
          justifyContent: 'center',
          flexWrap: portrait ? 'wrap' : 'nowrap',
          gap: `${size * 0.16}px ${size * 0.5}px`,
          fontSize: size * 0.5,
          fontWeight: 500,
          opacity: k,
          transform: `translateY(${(1 - k) * 12}px)`,
          maxWidth: portrait ? 900 : undefined,
        }}
      >
        {COPY.mcpClients.map((name, i) => {
          const lit = ease(frame, MCP.clientsIn + 10 + i * MCP.clientStep, MCP.clientsIn + 22 + i * MCP.clientStep)
          return (
            <span key={name} style={{ color: lit > 0.5 ? C.mint : C.textDim, transition: 'none' }}>
              {name}
            </span>
          )
        })}
      </div>
    </div>
  )
}
