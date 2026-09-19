import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api/client';

export function useDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const reload = async () => {
    try {
      setData(await api.dashboard());
      setError('');
    } catch (reason) {
      setError(reason.message);
    }
  };

  useEffect(() => {
    reload();
    const stream = new EventSource('/api/stream');
    stream.onmessage = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 180);
    };
    return () => {
      clearTimeout(timer.current);
      stream.close();
    };
  }, []);

  return { data, error, reload };
}
