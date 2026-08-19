import { useCallback, useEffect, useRef, useState } from 'react'

export function useRecurringTest(onTest: () => void) {
  const [isScheduled, setIsScheduled] = useState(
    () => localStorage.getItem('is-map-recurring-active') === 'true',
  )
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
    localStorage.removeItem('is-map-recurring-active')
  }, [])

  const start = useCallback(
    (minutes?: number) => {
      const mins = minutes ?? intervalMinutes
      setIntervalMinutes(mins)
      localStorage.setItem('is-map-recurring-interval', String(mins))
      stop()
      timerRef.current = setInterval(() => onTestRef.current(), mins * 60_000)
      setIsScheduled(true)
      localStorage.setItem('is-map-recurring-active', 'true')
    },
    [intervalMinutes, stop],
  )

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!isScheduled || timerRef.current) return
    timerRef.current = setInterval(() => onTestRef.current(), intervalMinutes * 60_000)
  }, [intervalMinutes, isScheduled])

  return { isScheduled, intervalMinutes, setIntervalMinutes, start, stop }
}
