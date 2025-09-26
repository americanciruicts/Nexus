'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { TravelerType } from '@/types';
import { apiService } from '@/services/api';

interface TravelerFormProps {
  onSubmit: (data: any) => void;
  loading?: boolean;
}

export function TravelerForm({ onSubmit, loading = false }: TravelerFormProps) {
  const [formData, setFormData] = useState({
    po_number: '',
    traveler_type_id: '',
    job_number: '',
  });
  const [travelerTypes, setTravelerTypes] = useState<TravelerType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  useEffect(() => {
    fetchTravelerTypes();
  }, []);

  const fetchTravelerTypes = async () => {
    try {
      const types = await apiService.getTravelerTypes();
      setTravelerTypes(types);
    } catch (error) {
      console.error('Failed to fetch traveler types:', error);
    } finally {
      setLoadingTypes(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      traveler_type_id: parseInt(formData.traveler_type_id),
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create New Traveler</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Purchase Order Number"
            name="po_number"
            value={formData.po_number}
            onChange={handleChange}
            required
            placeholder="e.g., PO-2024-001"
          />

          <Select
            label="Traveler Type"
            name="traveler_type_id"
            value={formData.traveler_type_id}
            onChange={handleChange}
            required
            disabled={loadingTypes}
          >
            <option value="">Select a type...</option>
            {travelerTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.type_name} - {type.description}
              </option>
            ))}
          </Select>

          <Input
            label="Job Number (Optional)"
            name="job_number"
            value={formData.job_number}
            onChange={handleChange}
            placeholder="e.g., JOB-001"
          />

          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Create Traveler
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}