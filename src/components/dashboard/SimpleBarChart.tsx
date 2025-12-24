type Point = { label: string; value: number }

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export default function SimpleBarChart(props: { points: Point[]; height?: number }) {
  const { points, height = 160 } = props

  const max = Math.max(1, ...points.map((p) => p.value))
  const width = Math.max(260, points.length * 14)
  const gap = 4
  const barW = 10
  const padY = 10

  return (
    <div className="w-full overflow-x-auto">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        {points.map((p, idx) => {
          const x = idx * (barW + gap) + 2
          const h = clamp((p.value / max) * (height - padY * 2), 0, height - padY * 2)
          const y = height - padY - h
          const fill = p.value > 0 ? 'rgba(2, 132, 199, 0.7)' : 'rgba(148, 163, 184, 0.25)'
          return <rect key={p.label} x={x} y={y} width={barW} height={h} rx={3} fill={fill} />
        })}
      </svg>
    </div>
  )
}
