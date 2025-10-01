'use client';

import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/layout/Layout';
import { ArrowLeftIcon, PrinterIcon, PencilIcon, QrCodeIcon } from '@heroicons/react/24/outline';

export default function TravelerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const travelerId = params.id as string;

  // Mock data - in real app, fetch from API
  const traveler = {
    id: travelerId,
    jobNumber: travelerId,
    partNumber: 'METSHIFT',
    description: 'METSHIFT Assembly',
    revision: 'V0.2',
    quantity: 250,
    customerCode: 'ACME',
    customerName: 'ACME Corporation',
    status: 'IN_PROGRESS',
    currentStep: 'WAVE SOLDER',
    progress: 75,
    createdAt: '2024-01-15',
    dueDate: '2024-01-25',
    priority: 'NORMAL',
    travelerType: 'PCB_ASSEMBLY',
    specs: 'Lead-free assembly, RoHS compliant',
    fromStock: '',
    toStock: '',
    shipVia: '',
    comments: '',
    steps: [
      { seq: 1, workCenter: 'ENGINEER', instruction: 'Review PCB assembly specifications', status: 'COMPLETED', assignee: 'John Doe', completedDate: '2024-01-15', quantity: 250, accepted: 250, rejected: 0, sign: 'JD' },
      { seq: 2, workCenter: 'MAKE BOM', instruction: 'Create Bill of Materials', status: 'COMPLETED', assignee: 'Jane Smith', completedDate: '2024-01-16', quantity: 250, accepted: 250, rejected: 0, sign: 'JS' },
      { seq: 6, workCenter: 'PREPARE', instruction: 'Prepare components', status: 'COMPLETED', assignee: 'Bob Johnson', completedDate: '2024-01-17', quantity: 250, accepted: 250, rejected: 0, sign: 'BJ' },
      { seq: 30, workCenter: 'WAVE SOLDER', instruction: 'Wave soldering process', status: 'IN_PROGRESS', assignee: 'Mike Wilson', completedDate: '', quantity: 250, accepted: 0, rejected: 0, sign: '' },
      { seq: 36, workCenter: 'VISUAL INSPECTION', instruction: 'Visual inspection', status: 'PENDING', assignee: '', completedDate: '', quantity: 250, accepted: 0, rejected: 0, sign: '' },
      { seq: 40, workCenter: 'E-TEST', instruction: 'Electrical testing', status: 'PENDING', assignee: '', completedDate: '', quantity: 250, accepted: 0, rejected: 0, sign: '' },
    ]
  };

  const handlePrint = () => {
    window.print();
  };

  const handleGenerateBarcode = () => {
    alert(`Barcode generated for Traveler #${travelerId}\n\nBarcode ID: TRV-${travelerId}-${Date.now()}`);
  };


  return (
    <Layout>
      <div className="space-y-6">
        {/* Header - Screen Only */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 shadow-lg rounded-xl p-6 border border-blue-500 no-print">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.back()}
                className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
              >
                <ArrowLeftIcon className="h-6 w-6 text-white" />
              </button>
              <div>
                <h1 className="text-3xl font-bold text-white mb-1">Traveler #{traveler.jobNumber}</h1>
                <p className="text-blue-100">{traveler.partNumber} - {traveler.description}</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleGenerateBarcode}
                className="flex items-center space-x-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-semibold transition-colors"
              >
                <QrCodeIcon className="h-5 w-5" />
                <span>Barcode</span>
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center space-x-2 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg font-semibold transition-colors"
              >
                <PrinterIcon className="h-5 w-5" />
                <span>Print</span>
              </button>
              <button
                onClick={() => router.push(`/travelers/${travelerId}/edit`)}
                className="flex items-center space-x-2 px-4 py-2 bg-white hover:bg-blue-50 text-blue-700 rounded-lg font-semibold transition-colors shadow-md"
              >
                <PencilIcon className="h-5 w-5" />
                <span>Edit</span>
              </button>
            </div>
          </div>
        </div>

        {/* Print Header - Top Row EXACTLY like image */}
        <div className="hidden print:block border-2 border-black p-1">
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* Left Column */}
            <div>
              <div className="mb-1">Page: 1 &nbsp;&nbsp; {new Date().toLocaleDateString()}</div>
              <div>Cust. Code: {traveler.customerCode}</div>
              <div>Cust. Name: {traveler.customerName}</div>
              <div>Work Order: {traveler.id}</div>
              <div>PO Number: N/A</div>
              <div>Start Dt: {traveler.createdAt}</div>
            </div>

            {/* Center Column */}
            <div className="text-center">
              <div className="text-lg font-bold mb-2">Job No: {traveler.jobNumber}</div>
            </div>

            {/* Right Column with BARCODE */}
            <div className="text-right">
              <div className="border-2 border-black p-2 inline-block mb-2">
                <svg width="120" height="60">
                  <rect x="2" y="5" width="2" height="50" fill="black"/>
                  <rect x="6" y="5" width="1" height="50" fill="black"/>
                  <rect x="9" y="5" width="3" height="50" fill="black"/>
                  <rect x="14" y="5" width="1" height="50" fill="black"/>
                  <rect x="17" y="5" width="2" height="50" fill="black"/>
                  <rect x="21" y="5" width="1" height="50" fill="black"/>
                  <rect x="24" y="5" width="3" height="50" fill="black"/>
                  <rect x="29" y="5" width="2" height="50" fill="black"/>
                  <rect x="33" y="5" width="1" height="50" fill="black"/>
                  <rect x="36" y="5" width="2" height="50" fill="black"/>
                  <rect x="40" y="5" width="3" height="50" fill="black"/>
                  <rect x="45" y="5" width="1" height="50" fill="black"/>
                  <rect x="48" y="5" width="2" height="50" fill="black"/>
                  <rect x="52" y="5" width="1" height="50" fill="black"/>
                  <rect x="55" y="5" width="3" height="50" fill="black"/>
                  <text x="60" y="58" fontSize="8" textAnchor="middle">*{traveler.jobNumber}*</text>
                </svg>
              </div>
              <div>Quantity: {traveler.quantity}</div>
              <div>Part No: {traveler.partNumber}</div>
              <div>Desc: {traveler.description}</div>
              <div>Rev: {traveler.revision}</div>
              <div>Ship Date: {traveler.dueDate}</div>
              <div>Due Date: {traveler.dueDate}</div>
            </div>
          </div>
        </div>

        {/* SPECS Section - EXACTLY like Image */}
        <div className="border-2 border-black mt-2">
          <div className="text-center font-bold text-sm border-b-2 border-black py-1 bg-gray-100">SPECS</div>
          <div className="text-xs p-2 min-h-[40px]">{traveler.specs || <span className="text-gray-400">_________________________________________________________________________________________________________________</span>}</div>
        </div>

        {/* ROUTING - EXACTLY like Image with underlines */}
        <div className="border-2 border-black mt-2">
          <div className="border-b-2 border-black py-1 px-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-sm">ROUTING</span>
              <span className="text-xs">To Stock: __________</span>
            </div>
          </div>

          {/* Column Headers - Aligned right like image */}
          <div className="text-right text-xs px-2 py-1 border-b border-black">
            <span className="inline-block w-16">Quantity</span>
            <span className="inline-block w-16">Rejected</span>
            <span className="inline-block w-16">Accepted</span>
            <span className="inline-block w-12">Sign</span>
            <span className="inline-block w-20">Date</span>
          </div>

          {/* Process Steps - EACH ROW like handwritten form */}
          <div className="p-2">
            {traveler.steps.map((step, index) => (
              <div key={index} className="mb-3">
                <div className="grid grid-cols-12 gap-2 text-xs items-center">
                  <div className="col-span-1 font-bold text-center">{step.seq}</div>
                  <div className="col-span-2 font-semibold">{step.workCenter}</div>
                  <div className="col-span-3 border-b border-black">{step.instruction || '_____________________________'}</div>
                  <div className="col-span-1 text-center border-b border-black">{step.quantity || '____'}</div>
                  <div className="col-span-1 text-center border-b border-black">{step.rejected || '____'}</div>
                  <div className="col-span-1 text-center border-b border-black">{step.accepted || '____'}</div>
                  <div className="col-span-1 text-center border-b border-black">{step.sign || '___'}</div>
                  <div className="col-span-2 text-center border-b border-black">{step.completedDate || '__________'}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t-2 border-black p-2 text-xs">
            <div className="flex justify-between">
              <span>From Stock: _______________</span>
              <span>Ship VIA: _______________</span>
            </div>
          </div>
        </div>

        {/* COMMENTS Section - EXACTLY like Image */}
        <div className="border-2 border-black mt-2 p-2">
          <div className="font-bold text-xs mb-1">COMMENTS:</div>
          <div className="min-h-[80px] text-xs border-b border-black">{traveler.comments || ''}</div>
        </div>

        {/* PAGE 2 - Labor Hours and Additional Instructions */}
        <div className="print-page-break bg-white border-2 border-gray-300 rounded-lg p-4 mt-6">
          <h2 className="text-xl font-bold border-b-2 border-black pb-2 mb-4">PAGE 2 - LABOR HOURS &amp; ADDITIONAL INSTRUCTIONS</h2>

          {/* Labor Hours Table */}
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 uppercase">Labor Hours Tracking:</h3>
            <table className="w-full border-2 border-black text-xs">
              <thead>
                <tr className="bg-gray-200">
                  <th className="border border-black px-2 py-2">Operator Name</th>
                  <th className="border border-black px-2 py-2">Start Time</th>
                  <th className="border border-black px-2 py-2">End Time</th>
                  <th className="border border-black px-2 py-2">Total Hours</th>
                  <th className="border border-black px-2 py-2">Signature</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => (
                  <tr key={row}>
                    <td className="border border-black px-2 py-3"></td>
                    <td className="border border-black px-2 py-3"></td>
                    <td className="border border-black px-2 py-3"></td>
                    <td className="border border-black px-2 py-3"></td>
                    <td className="border border-black px-2 py-3"></td>
                  </tr>
                ))}
                <tr className="bg-gray-200 font-bold">
                  <td colSpan={3} className="border border-black px-2 py-2 text-right">TOTAL HOURS:</td>
                  <td className="border border-black px-2 py-2"></td>
                  <td className="border border-black px-2 py-2"></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Additional Instructions Area */}
          <div className="mb-4">
            <h3 className="font-bold text-sm mb-2 uppercase">Additional Instructions &amp; Notes:</h3>
            <div className="border-2 border-black rounded p-3 min-h-[300px] bg-white">
              {/* Empty space for handwritten notes */}
            </div>
          </div>

          {/* Sign-off Section */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border-2 border-black rounded p-3">
              <h4 className="font-bold text-sm mb-3">Quality Inspector:</h4>
              <div className="space-y-2">
                <div className="flex">
                  <span className="w-20 font-bold text-xs">Name:</span>
                  <div className="flex-1 border-b border-black"></div>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-xs">Signature:</span>
                  <div className="flex-1 border-b border-black"></div>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-xs">Date:</span>
                  <div className="flex-1 border-b border-black"></div>
                </div>
              </div>
            </div>
            <div className="border-2 border-black rounded p-3">
              <h4 className="font-bold text-sm mb-3">Supervisor:</h4>
              <div className="space-y-2">
                <div className="flex">
                  <span className="w-20 font-bold text-xs">Name:</span>
                  <div className="flex-1 border-b border-black"></div>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-xs">Signature:</span>
                  <div className="flex-1 border-b border-black"></div>
                </div>
                <div className="flex">
                  <span className="w-20 font-bold text-xs">Date:</span>
                  <div className="flex-1 border-b border-black"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
