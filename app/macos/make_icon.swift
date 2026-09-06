import AppKit

// 「拾忆」应用 Logo —— 明亮简笔画：对话气泡 + 三颗话点 + 一点星光
// 用法: swift make_icon.swift <输出路径.png>

let outputPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-src.png"
let size = 1024

guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: size,
  pixelsHigh: size,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fatalError("无法创建位图")
}

let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx

let canvas = NSRect(x: 0, y: 0, width: size, height: size)
NSColor.clear.setFill()
NSBezierPath(rect: canvas).fill()

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
  NSColor(
    srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
    green: CGFloat((hex >> 8) & 0xFF) / 255,
    blue: CGFloat(hex & 0xFF) / 255,
    alpha: alpha
  )
}

// 背景：清透的天空蓝渐变（明亮但不刺眼）
let inset: CGFloat = 80
let bgRect = canvas.insetBy(dx: inset, dy: inset)
let bgPath = NSBezierPath(roundedRect: bgRect, xRadius: 216, yRadius: 216)
let bg = NSGradient(colors: [
  color(0xAFCBFF),
  color(0x7FA6F0),
  color(0x5D8AE8),
])!
bg.draw(in: bgPath, angle: 18)

// 顶部柔光
NSGraphicsContext.current?.saveGraphicsState()
bgPath.addClip()
let sheen = NSGradient(colors: [
  NSColor.white.withAlphaComponent(0.24),
  NSColor.white.withAlphaComponent(0.0),
])!
sheen.draw(
  in: NSRect(x: bgRect.minX, y: bgRect.midY, width: bgRect.width, height: bgRect.height * 0.7),
  angle: -90
)
NSGraphicsContext.current?.restoreGraphicsState()

let white = NSColor.white

// 描边画笔：简笔画质感
NSGraphicsContext.current?.saveGraphicsState()
NSGraphicsContext.current?.shouldAntialias = true
NSGraphicsContext.current?.imageInterpolation = .high

// ---------- 对话气泡轮廓 ----------
let bubble = NSBezierPath(roundedRect: NSRect(x: 292, y: 360, width: 450, height: 410), xRadius: 196, yRadius: 196)
bubble.lineWidth = 44
bubble.lineJoinStyle = .round
white.setStroke()
bubble.stroke()

// 气泡小尾巴（纯白色填充，与描边同色）
let tail = NSBezierPath()
tail.move(to: NSPoint(x: 330, y: 368))
tail.curve(
  to: NSPoint(x: 250, y: 250),
  controlPoint1: NSPoint(x: 298, y: 318),
  controlPoint2: NSPoint(x: 258, y: 300)
)
tail.curve(
  to: NSPoint(x: 398, y: 362),
  controlPoint1: NSPoint(x: 310, y: 242),
  controlPoint2: NSPoint(x: 372, y: 280)
)
tail.close()
white.setFill()
tail.fill()

// ---------- 三颗「话点」 ----------
let dots: [CGFloat] = [452, 517, 582]
for x in dots {
  let dot = NSBezierPath(ovalIn: NSRect(x: x - 26, y: 530, width: 52, height: 52))
  white.setFill()
  dot.fill()
}

// ---------- 右上角暖黄星光（拾到的那一点光） ----------
let starC = NSPoint(x: 794, y: 806)
let s: CGFloat = 76
let glow = NSShadow()
glow.shadowColor = color(0xFFF0B8, 0.8)
glow.shadowBlurRadius = 18
glow.shadowOffset = NSSize(width: 0, height: 0)
NSGraphicsContext.current?.saveGraphicsState()
glow.set()

let star = NSBezierPath()
star.move(to: NSPoint(x: starC.x, y: starC.y + s))
star.curve(
  to: NSPoint(x: starC.x + s * 0.3, y: starC.y + s * 0.3),
  controlPoint1: NSPoint(x: starC.x + s * 0.16, y: starC.y + s * 0.62),
  controlPoint2: NSPoint(x: starC.x + s * 0.28, y: starC.y + s * 0.44)
)
star.curve(
  to: NSPoint(x: starC.x + s, y: starC.y),
  controlPoint1: NSPoint(x: starC.x + s * 0.44, y: starC.y + s * 0.3),
  controlPoint2: NSPoint(x: starC.x + s * 0.66, y: starC.y + s * 0.16)
)
star.curve(
  to: NSPoint(x: starC.x + s * 0.3, y: starC.y - s * 0.3),
  controlPoint1: NSPoint(x: starC.x + s * 0.66, y: starC.y - s * 0.16),
  controlPoint2: NSPoint(x: starC.x + s * 0.44, y: starC.y - s * 0.3)
)
star.curve(
  to: NSPoint(x: starC.x, y: starC.y - s),
  controlPoint1: NSPoint(x: starC.x + s * 0.28, y: starC.y - s * 0.44),
  controlPoint2: NSPoint(x: starC.x + s * 0.16, y: starC.y - s * 0.62)
)
star.curve(
  to: NSPoint(x: starC.x - s * 0.3, y: starC.y - s * 0.3),
  controlPoint1: NSPoint(x: starC.x - s * 0.16, y: starC.y - s * 0.62),
  controlPoint2: NSPoint(x: starC.x - s * 0.28, y: starC.y - s * 0.44)
)
star.curve(
  to: NSPoint(x: starC.x - s, y: starC.y),
  controlPoint1: NSPoint(x: starC.x - s * 0.44, y: starC.y - s * 0.3),
  controlPoint2: NSPoint(x: starC.x - s * 0.66, y: starC.y - s * 0.16)
)
star.curve(
  to: NSPoint(x: starC.x - s * 0.3, y: starC.y + s * 0.3),
  controlPoint1: NSPoint(x: starC.x - s * 0.66, y: starC.y + s * 0.16),
  controlPoint2: NSPoint(x: starC.x - s * 0.44, y: starC.y + s * 0.3)
)
star.close()
color(0xFFD98A).setFill()
star.fill()
NSGraphicsContext.current?.restoreGraphicsState()

NSGraphicsContext.current?.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
  fatalError("PNG 编码失败")
}
try png.write(to: URL(fileURLWithPath: outputPath))
print("已生成: \(outputPath)")
