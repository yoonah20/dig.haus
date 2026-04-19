import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from '../lib/axios';

export interface Genre {
  id: number;
  slug: string;
  name_ko: string;
  name_en: string;
  position: number;
  is_active: number;
  created_at: string;
}

export function useGenres(enabled: boolean) {
  return useQuery<{ genres: Genre[] }>({
    queryKey: ['admin-genres'],
    queryFn: async () => {
      const { data } = await axios.get('/api/admin/genres');
      return data;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useAddGenre() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean; id: number },
    unknown,
    { slug: string; nameKo: string; nameEn: string }
  >({
    mutationFn: async (input) => {
      const { data } = await axios.post('/api/admin/genres', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-genres'] });
    },
  });
}

export function useUpdateGenre() {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    unknown,
    {
      id: number;
      nameKo?: string;
      nameEn?: string;
      isActive?: boolean;
      position?: number;
    }
  >({
    mutationFn: async ({ id, ...patch }) => {
      await axios.patch(`/api/admin/genres/${id}`, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-genres'] });
    },
  });
}

export function useDeleteGenre() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, number>({
    mutationFn: async (id: number) => {
      await axios.delete(`/api/admin/genres/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-genres'] });
    },
  });
}
