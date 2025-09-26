'use client';

import { useState, useEffect } from 'react';
import { Layout } from '@/components/layout/Layout';
import { TravelerCard } from '@/components/travelers/TravelerCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Traveler } from '@/types';
import { apiService } from '@/services/api';
import Link from 'next/link';

export default function TravelersPage() {
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchTravelers();
  }, []);

  const fetchTravelers = async () => {
    try {
      const data = await apiService.getTravelers();
      setTravelers(data);
    } catch (error) {
      console.error('Failed to fetch travelers:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTravelers = travelers.filter(traveler =>
    traveler.traveler_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    traveler.purchase_order.po_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    traveler.purchase_order.customer_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="p-6">
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Travelers</h1>
              <p className="mt-1 text-sm text-gray-600">
                Manage and track all traveler documents
              </p>
            </div>
            <Link href="/travelers/new">
              <Button>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New Traveler
              </Button>
            </Link>
          </div>
        </div>

        <div className="mb-6">
          <Input
            placeholder="Search travelers, PO numbers, or customers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-md"
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-200 h-48 rounded-lg"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTravelers.map((traveler) => (
              <TravelerCard key={traveler.id} traveler={traveler} />
            ))}
          </div>
        )}

        {!loading && filteredTravelers.length === 0 && (
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No travelers found</h3>
            <p className="mt-1 text-sm text-gray-500">Get started by creating a new traveler.</p>
            <div className="mt-6">
              <Link href="/travelers/new">
                <Button>
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Create New Traveler
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}