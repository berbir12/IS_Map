import { useCallback, useEffect, useRef, useState } from 'react'

export function useRecurringTest(onTest: () => void) {
  const [isScheduled, setIsScheduled] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState(
    () => Number(localStorage.getItem('is-map-recurring-interval') || '30'),
  )
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onTestRef = useRef(onTest)

  useEffect(() => {
    onTestRef.current = onTest
  }, [onTest])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setIsScheduled(false)
  }, [])

  const start = useCallback(
    (minutes?: number) => {
      const mins = minutes ?? intervalMinutes
      setIntervalMinutes(mins)
      localStorage.setItem('is-map-recurring-interval', String(mins))
      stop()
      timerRef.current = setInterval(() => onTestRef.current(), mins * 60_000)
      setIsScheduled(true)
    },
    [intervalMinutes, stop],
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
    },
    [],
  )

  return { isScheduled, intervalMinutes, setIntervalMinutes, start, stop }
}
