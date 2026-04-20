/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Upload, 
  MapPin, 
  QrCode, 
  ListChecks, 
  History, 
  Download, 
  X, 
  AlertCircle, 
  CheckCircle2, 
  Search,
  LayoutDashboard,
  ShieldAlert,
  User,
  FileUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { InventoryItem, ScanLogEntry } from './types';

// Regex for extracting SN: S/N: [ID] or Serial: [ID]
const SN_REGEX = /(?:S\/N:|Serial:)\s*([a-zA-Z0-9_-]+)/i;

export default function App() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [logs, setLogs] = useState<ScanLogEntry[]>([]);
  const [currentTab, setCurrentTab] = useState<'scan' | 'pending' | 'audited' | 'logs'>('scan');
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear();
      }
    };
  }, []);

  // Derived Values
  const cities = useMemo(() => {
    const unique = Array.from(new Set(inventory.map(item => item.city.trim() || 'GENERAL')));
    return unique.sort();
  }, [inventory]);
  
  const filteredInventory = useMemo(() => {
    if (!selectedCity) return [];
    return inventory.filter(item => (item.city.trim() || 'GENERAL') === selectedCity);
  }, [inventory, selectedCity]);

  const auditedItems = useMemo(() => {
    return filteredInventory.filter(item => item.status === 'audited');
  }, [filteredInventory]);

  const pendingItems = useMemo(() => {
    return filteredInventory.filter(item => item.status === 'pending');
  }, [filteredInventory]);

  // Actions
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const getVal = (row: any, keys: string[]) => {
          const foundKey = Object.keys(row).find(k => 
            keys.some(searchKey => k.toLowerCase().trim() === searchKey.toLowerCase().trim())
          );
          return foundKey ? (row[foundKey]?.toString() || '').trim() : '';
        };

        const mappedData: InventoryItem[] = results.data.map((row: any) => ({
          serial: getVal(row, ['Serial', 'SN', 'Serial/SN', 'Serial Number', 'S/N']),
          model: getVal(row, ['Modelo', 'Model', 'Categoría', 'Equipo']),
          user: getVal(row, ['Usuario', 'User', 'ID', 'Cedula', 'Documento']),
          user_name: getVal(row, ['Nombre', 'Name', 'Personal', 'Funcionario', 'Asignado', 'Nombre Funcionario', 'Personal Asignado', 'Nombre Completo']),
          city: getVal(row, ['Ciudad', 'Sede', 'City', 'Ubicación', 'Sede Trabajo']),
          status: 'pending' as const
        })).filter(item => item.serial);
        
        setInventory(mappedData);
        setLogs([]);
        setSelectedCity(null);
      }
    });
  };

  const processScan = (decodedText: string) => {
    // Extract Serial via Regex or use raw text if it looks like a serial
    let targetSerial = '';
    const match = decodedText.match(SN_REGEX);
    if (match && match[1]) {
      targetSerial = match[1];
    } else {
      // Fallback: if no label found, use the whole text trimmed (assuming the QR might just be the SN)
      targetSerial = decodedText.trim();
    }

    const timestamp = new Date().toLocaleString();
    const entryId = Math.random().toString(36).substring(7);

    // 1. Check if it exists in the FULL database
    const itemInDb = inventory.find(i => 
      (i.serial?.toString() || '').toLowerCase().trim() === targetSerial.toLowerCase().trim()
    );

    if (!itemInDb) {
      // No Encontrado
      setLogs(prev => [{
        id: entryId,
        timestamp,
        serial: targetSerial,
        result: 'not_found',
        details: 'El serial no existe en la base de datos cargada.'
      }, ...prev]);
      return;
    }

    // 2. Already audited?
    if (itemInDb.status === 'audited') {
       setLogs(prev => [{
        id: entryId,
        timestamp,
        serial: targetSerial,
        result: 'already_audited',
        details: `Activo ya auditado previamente (${itemInDb.auditedAt}).`,
        model: itemInDb.model,
        user: itemInDb.user,
        user_name: itemInDb.user_name
      }, ...prev]);
      return;
    }

    // 3. Check City Match
    const itemCity = (itemInDb.city?.toString() || '').trim() || 'GENERAL';
    if (itemCity !== selectedCity) {
      // Error de Ubicación
      setLogs(prev => [{
        id: entryId,
        timestamp,
        serial: targetSerial,
        result: 'wrong_city',
        details: `Activo pertenece a ${itemCity}, no a la ciudad actual.`,
        model: itemInDb.model,
        user: itemInDb.user,
        user_name: itemInDb.user_name
      }, ...prev]);
      return;
    }

    // 4. Success Case
    setInventory(prev => prev.map(item => 
      item.serial === itemInDb.serial 
        ? { ...item, status: 'audited', auditedAt: timestamp } 
        : item
    ));

    setLogs(prev => [{
      id: entryId,
      timestamp,
      serial: targetSerial,
      result: 'success',
      details: 'Auditado con éxito.',
      model: itemInDb.model,
      user: itemInDb.user,
      user_name: itemInDb.user_name
    }, ...prev]);
  };

  const startScanner = () => {
    if (isScanning) return;
    setIsScanning(true);
    
    // Give time for the "reader" div to mount
    setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          "reader",
          { 
            fps: 15, 
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          /* verbose= */ false
        );

        scanner.render((decodedText) => {
          processScan(decodedText);
          scanner.clear().catch(err => console.warn("Error clearing scanner:", err));
          setIsScanning(false);
        }, (error) => {
          // Continuous scanning mode usually ignores trivial frame-capture errors
        });
        
        scannerRef.current = scanner;
      } catch (err) {
        console.error("Failed to initialize scanner:", err);
        setIsScanning(false);
      }
    }, 300);
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current.clear();
    }
    setIsScanning(false);
  };

  const exportInventory = () => {
    const csvData = Papa.unparse(inventory.map(item => ({
      'Serial/SN': item.serial,
      'Modelo': item.model,
      'ID Usuario': item.user,
      'Nombre Personal': item.user_name || '',
      'Ciudad': item.city,
      'Estado Auditoria': item.status,
      'Fecha Auditoria': item.auditedAt || ''
    })));

    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `auditoria_${selectedCity || 'completa'}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (inventory.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-10 rounded-3xl shadow-xl shadow-slate-200 border border-slate-100 text-center"
        >
          <div className="mb-8 mx-auto w-20 h-20 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-200 flex items-center justify-center transition-transform hover:scale-110">
            <Upload size={36} />
          </div>
          <h1 className="text-3xl font-black text-slate-800 mb-3 tracking-tight">Iniciar Auditoría</h1>
          <p className="text-slate-500 mb-10 text-sm font-medium">
            Sube tu archivo de inventario en formato CSV para comenzar el escaneo offline.
          </p>
          
          <label className="block w-full py-5 px-6 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-all group">
            <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
            <div className="flex flex-col items-center gap-2">
              <FileUp size={20} className="text-slate-400 group-hover:text-indigo-600" />
              <span className="font-bold text-slate-700 group-hover:text-indigo-700">Seleccionar Inventario (.csv)</span>
            </div>
          </label>
          
          <div className="mt-10 pt-8 border-t border-slate-50 text-left">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Columnas Requeridas:</h4>
            <div className="grid grid-cols-2 gap-y-2">
              {['Serial/SN', 'Modelo', 'Personal', 'Ciudad/Sede'].map(col => (
                <div key={col} className="flex items-center gap-2">
                   <div className="w-1 h-1 bg-indigo-400 rounded-full"></div>
                   <span className="text-[11px] font-bold text-slate-600">{col}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!selectedCity) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="max-w-5xl w-full">
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-200 mb-6 transition-transform hover:scale-110">
              <QrCode size={32} />
            </div>
            <h2 className="text-4xl font-black text-slate-800 tracking-tight">Sedes Detectadas</h2>
            <p className="text-slate-500 mt-2 text-lg font-medium">Selecciona una ubicación para iniciar la auditoría</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* New File Option */}
            <label className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-all group min-h-[180px]">
              <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-3 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                <FileUp size={24} />
              </div>
              <span className="font-bold text-slate-700">Cambiar Base de Datos</span>
              <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-black">Subir otro archivo CSV</span>
            </label>

            {cities.map((city) => {
              const cityItems = inventory.filter(item => (item.city.trim() || 'GENERAL') === city);
              const audited = cityItems.filter(i => i.status === 'audited').length;
              const pending = cityItems.filter(i => i.status === 'pending').length;
              const totalItems = cityItems.length;

              return (
                <motion.button
                  key={city}
                  whileHover={{ y: -8, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedCity(city)}
                  className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 text-left hover:shadow-2xl transition-all hover:border-indigo-200 group relative overflow-hidden"
                >
                  <div className="absolute -top-4 -right-4 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <MapPin size={80} />
                  </div>

                  <h3 className="text-3xl font-black text-slate-800 mb-1 group-hover:text-indigo-600 transition-colors uppercase truncate relative z-10">
                    {city}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6 relative z-10">Ubicación</p>
                  
                  <div className="space-y-5 relative z-10">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100 group-hover:bg-indigo-50/30 group-hover:border-indigo-100 transition-colors">
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase leading-none mb-1 block">Auditados</span>
                        <span className="text-xl font-black text-indigo-600 leading-none">{audited}</span>
                      </div>
                      <div className="bg-slate-50/80 p-3 rounded-2xl border border-slate-100 group-hover:bg-slate-100/50 transition-colors">
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase leading-none mb-1 block">Pendientes</span>
                        <span className="text-xl font-black text-slate-800 leading-none">{pending}</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-50">
                       <div className="flex justify-between items-end mb-2">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Equipos: {totalItems}</span>
                        <span className="text-sm font-black text-indigo-600">
                          {Math.round((audited / totalItems) * 100)}%
                        </span>
                      </div>
                      <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(audited / totalItems) * 100}%` }}
                          className="h-full bg-gradient-to-r from-indigo-500 to-violet-600 rounded-full transition-all duration-1000"
                        />
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:h-screen w-full flex flex-col bg-slate-50 text-slate-900 overflow-x-hidden lg:overflow-hidden">
      {/* Header - Clean & Minimalist */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center shrink-0">
            <QrCode className="w-5 h-5 text-white" />
          </div>
          <div className="flex items-center gap-3">
             <span className="text-sm font-bold text-slate-600 uppercase tracking-tight">Sede Actual:</span>
             <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-bold border border-indigo-100">{selectedCity}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-emerald-50 rounded-full px-3 py-1 border border-emerald-100 shrink-0">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-2 animate-pulse"></div>
            <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Base de Datos Activa</span>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-full lg:w-80 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-4 sm:p-6 flex flex-col gap-6 shrink-0 lg:overflow-y-auto">
          <div>
            <label className="sidebar-label">Configuración de Sede</label>
            <div className="relative">
              <select 
                value={selectedCity || ''}
                onChange={(e) => setSelectedCity(e.target.value || null)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer pr-10"
              >
                <option value="">Seleccionar Ciudad</option>
                {cities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
              <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            </div>
            {selectedCity && (
              <button 
                onClick={() => setSelectedCity(null)}
                className="mt-2 text-[10px] font-mono text-indigo-600 hover:underline uppercase"
              >
                ← Cambiar Ciudad
              </button>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <label className="sidebar-label text-center">Escáner de Activos</label>
            <div className="flex-1 flex flex-col min-h-[300px]">
              <div className="relative flex-1 rounded-2xl bg-slate-900 border-4 border-slate-100 shadow-inner overflow-hidden flex items-center justify-center min-h-[200px]">
                {!isScanning ? (
                  <div className="flex flex-col items-center gap-4">
                    <QrCode size={48} className="text-indigo-400 opacity-20" />
                    <button 
                      onClick={startScanner}
                      disabled={!selectedCity}
                      className="py-2.5 px-6 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Activar Cámara
                    </button>
                    {!selectedCity && <p className="text-[10px] text-slate-500">Seleccione una ciudad primero</p>}
                  </div>
                ) : (
                  <div id="reader" className="w-full h-full"></div>
                )}
                
                {isScanning && (
                  <div className="absolute inset-0 pointer-events-none border-2 border-indigo-500/30 m-8 rounded-lg animate-pulse" />
                )}
              </div>
              
              {isScanning && (
                <button 
                  onClick={stopScanner}
                  className="mt-3 py-2 border border-rose-200 text-rose-600 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-rose-50 transition-colors"
                >
                  Detener Escáner
                </button>
              )}
            </div>

            <AnimatePresence>
              {logs.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`mt-4 p-4 rounded-xl border ${
                    logs[0].result === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-900' :
                    logs[0].result === 'wrong_city' ? 'bg-amber-50 border-amber-100 text-amber-900' :
                    'bg-rose-50 border-rose-100 text-rose-900'
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase opacity-60 mb-1 flex justify-between">
                    <span>{logs[0].result === 'success' ? 'Detección Exitosa' : 'Alerta de Escaneo'}</span>
                    <span>{logs[0].timestamp.split(', ')[1]}</span>
                  </p>
                  <p className="text-base font-mono font-bold leading-tight tracking-tighter truncate">
                    {logs[0].serial}
                  </p>
                    {logs[0].model && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Modelo:</p>
                        <p className="text-xs font-medium text-slate-700">{logs[0].model}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase leading-none pt-1">Personal Asignado:</p>
                        <div className="flex flex-col">
                          <p className="text-xs font-bold text-slate-800 leading-tight">{logs[0].user_name || logs[0].user || 'Sin Nombre'}</p>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] mt-3 font-bold opacity-70 flex items-center gap-1">
                      {logs[0].result === 'success' ? <CheckCircle2 size={10}/> : <AlertCircle size={10}/>}
                      {logs[0].details}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={exportInventory}
              className="mt-2 w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 text-sm"
            >
              <Download size={18} /> Reconciliar & Exportar
            </button>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 p-6 flex flex-col gap-6 overflow-hidden bg-slate-50">
          
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 shrink-0">
            <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Total Ciudad</span>
              <span className="text-2xl sm:text-3xl font-black text-slate-800">{filteredInventory.length}</span>
              <span className="text-[10px] ml-2 font-mono text-slate-400">UNIDADES</span>
            </div>
            <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200 border-l-4 border-l-emerald-500">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Auditados</span>
              <span className="text-2xl sm:text-3xl font-black text-emerald-600">
                {auditedItems.length} 
                <span className="text-xs sm:text-sm text-slate-400 font-medium ml-1 sm:ml-2">
                  ({filteredInventory.length ? Math.round((auditedItems.length / filteredInventory.length) * 100) : 0}%)
                </span>
              </span>
            </div>
            <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200 border-l-4 border-l-amber-500">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">Pendientes</span>
              <span className="text-2xl sm:text-3xl font-black text-amber-600">{pendingItems.length}</span>
              <span className="text-[10px] ml-2 font-mono text-slate-400">POR REVISAR</span>
            </div>
          </div>

          {/* Main Table Container */}
          <div className="flex-1 bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
            {/* Tabs Navigation */}
            <div className="flex border-b border-slate-100 bg-slate-50/50 overflow-x-auto scrollbar-hide shrink-0">
              {[
                { id: 'scan', label: 'Historial', icon: History },
                { id: 'pending', label: 'Pendientes', icon: ShieldAlert },
                { id: 'audited', label: 'Auditados', icon: ListChecks },
                { id: 'logs', label: 'Datos Crudos', icon: LayoutDashboard }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCurrentTab(tab.id as any)}
                  className={`px-4 sm:px-6 py-4 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 border-b-2 whitespace-nowrap shrink-0 ${
                    currentTab === tab.id 
                    ? 'border-indigo-600 text-indigo-600 bg-white' 
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <tab.icon size={14} className="shrink-0" />
                  {tab.id === 'pending' ? `PENDIENTES (${selectedCity})` : tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-white">
              <AnimatePresence mode="wait">
                {currentTab === 'scan' && (
                  <motion.div key="scan" className="flex-1 flex flex-col min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div className="grid grid-cols-4 sm:grid-cols-12 px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest sticky top-0 shrink-0">
                      <div className="col-span-1 hidden sm:block">STATUS</div>
                      <div className="col-span-2 sm:col-span-3 text-slate-400">SERIAL:</div>
                      <div className="col-span-2 sm:col-span-3 text-slate-400">MODELO:</div>
                      <div className="col-span-3 hidden sm:block text-slate-400">PERSONAL ASIGNADO:</div>
                      <div className="col-span-2 text-right hidden sm:block">TIMESTAMP</div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-50 min-h-0">
                      {logs.map(log => (
                        <div key={log.id} className={`grid grid-cols-4 sm:grid-cols-12 px-4 sm:px-6 py-4 items-center transition-colors ${
                          log.result === 'wrong_city' ? 'bg-amber-50/50' : 
                          log.result === 'not_found' ? 'bg-rose-50/50' : 'hover:bg-slate-50'
                        }`}>
                          <div className="col-span-1 hidden sm:block">
                            <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase ${
                              log.result === 'success' ? 'bg-emerald-100 text-emerald-700' :
                              log.result === 'wrong_city' ? 'bg-amber-100 text-amber-700' :
                              'bg-rose-100 text-rose-700'
                            }`}>
                              {log.result === 'success' ? 'OK' : log.result === 'wrong_city' ? 'UBIC' : 'NULL'}
                            </span>
                          </div>
                          <div className="col-span-2 sm:col-span-3 font-mono text-sm font-bold tracking-tight truncate border-l-2 sm:border-l-0 pl-2 sm:pl-0 border-indigo-200">
                             {log.serial}
                             <div className="sm:hidden text-[9px] font-bold uppercase opacity-60 mt-1">
                               {log.result === 'success' ? <span className="text-emerald-600">Auditado OK</span> : <span className="text-rose-600">Error Detección</span>}
                             </div>
                          </div>
                          <div className="col-span-2 sm:col-span-3 text-sm text-slate-600 truncate pr-4">{log.model || '---'}</div>
                          <div className="col-span-3 text-slate-700 hidden sm:block">
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-bold truncate leading-tight">{log.user_name || log.user || '---'}</span>
                            </div>
                          </div>
                          <div className="col-span-2 text-right text-xs text-slate-400 font-mono italic hidden sm:block">{log.timestamp.split(', ')[1]}</div>
                          <div className="col-span-4 sm:col-span-12 mt-1 sm:mt-1 text-[10px] font-medium text-amber-700 flex items-center gap-1 opacity-70">
                            {log.result !== 'success' ? <AlertCircle size={10} /> : <div className="sm:hidden flex items-center gap-2 text-emerald-700"><CheckCircle2 size={10} /> {log.timestamp.split(', ')[1]} • <div className="flex items-center gap-1"><b>{log.user_name || log.user}</b></div></div>}
                            {log.result !== 'success' && log.details}
                          </div>
                        </div>
                      ))}
                      {logs.length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center py-20 opacity-30 gap-3">
                          <History size={48} />
                          <p className="font-mono text-sm uppercase tracking-widest font-bold">Sin registros recientes</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {currentTab === 'pending' && (
                  <motion.div key="pending" className="flex-1 flex flex-col min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                     <div className="p-3 sm:p-4 bg-slate-50 flex items-center gap-4 shrink-0">
                       <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input 
                          type="text" 
                          placeholder="Filtro rápido..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl bg-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                       </div>
                     </div>
                     <div className="grid grid-cols-1 sm:grid-cols-12 px-4 sm:px-6 py-2 sm:py-3 bg-slate-50 border-y border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
                      <div className="col-span-1 sm:col-span-4 self-center">SERIAL:</div>
                      <div className="col-span-1 sm:col-span-4 hidden sm:block self-center">MODELO:</div>
                      <div className="col-span-4 hidden sm:block self-center">PERSONAL ASIGNADO:</div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-50 min-h-0">
                      {pendingItems.filter(i => 
                        i.serial.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        i.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (i.user_name && i.user_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                        i.model.toLowerCase().includes(searchQuery.toLowerCase())
                      ).map(item => (
                        <div key={item.serial} className="flex flex-col sm:grid sm:grid-cols-12 px-4 sm:px-6 py-4 sm:items-center hover:bg-slate-50 group gap-1.5 sm:gap-0">
                           <div className="sm:col-span-4">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5">Serial:</span>
                             <span className="font-mono text-sm font-bold">{item.serial}</span>
                           </div>
                           <div className="sm:col-span-4">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5">Modelo:</span>
                             <span className="text-sm text-slate-600 sm:truncate sm:pr-4">{item.model}</span>
                           </div>
                           <div className="sm:col-span-4">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5 shrink-0">Personal Asignado:</span>
                             <div className="flex flex-col">
                               <span className="text-sm text-slate-800 font-bold leading-tight">{item.user_name || item.user || 'Sin Nombre'}</span>
                             </div>
                           </div>
                        </div>
                      ))}
                      {pendingItems.length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
                          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                            <CheckCircle2 size={32} />
                          </div>
                          <div className="text-center">
                            <p className="font-bold text-lg">Sede Conciliada</p>
                            <p className="text-sm text-slate-400">Todos los equipos de {selectedCity} han sido auditados.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Simplified logs & audited views inside here with same patterns... */}
                {currentTab === 'audited' && (
                  <motion.div key="audited" className="flex-1 flex flex-col min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 sm:px-6 py-2 sm:py-3 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
                      <div className="col-span-1 sm:col-span-3">SERIAL:</div>
                      <div className="col-span-1 sm:col-span-3 hidden sm:block">MODELO:</div>
                      <div className="col-span-3 hidden sm:block">PERSONAL ASIGNADO:</div>
                      <div className="col-span-3 text-right hidden sm:block">FECHA:</div>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-50 min-h-0">
                      {auditedItems.map(item => (
                        <div key={item.serial} className="flex flex-col sm:grid sm:grid-cols-12 px-4 sm:px-6 py-4 sm:items-center hover:bg-slate-50 gap-2 sm:gap-0">
                           <div className="sm:col-span-3">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5">Serial:</span>
                             <span className="font-mono text-sm font-bold text-emerald-700">{item.serial}</span>
                           </div>
                           <div className="sm:col-span-3">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5">Modelo:</span>
                             <span className="text-sm text-slate-600 sm:truncate sm:pr-4">{item.model}</span>
                           </div>
                           <div className="sm:col-span-3">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5">Personal Asignado:</span>
                             <div className="flex flex-col">
                               <span className="text-sm text-slate-800 font-bold leading-tight">{item.user_name || item.user || 'Sin Nombre'}</span>
                             </div>
                           </div>
                           <div className="sm:col-span-3 sm:text-right">
                             <span className="sm:hidden text-[9px] font-bold text-slate-400 uppercase mr-2.5">Fecha:</span>
                             <span className="font-mono text-xs text-slate-400">{item.auditedAt}</span>
                           </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {currentTab === 'logs' && (
                   <motion.div key="raw-logs" className="flex-1 p-6 overflow-y-auto min-h-0 bg-slate-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                     <div className="space-y-3">
                       {logs.map(log => (
                         <div key={log.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row justify-between gap-2">
                            <div className="flex gap-4 items-start">
                              <div className={`p-2 rounded ${
                                log.result === 'success' ? 'bg-emerald-100 text-emerald-700' :
                                log.result === 'wrong_city' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                              }`}>
                                {log.result === 'success' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}
                              </div>
                              <div>
                                <p className="font-mono font-bold text-sm leading-none">{log.serial}</p>
                                <p className="text-xs mt-1 text-slate-600">{log.details}</p>
                              </div>
                            </div>
                            <div className="text-right flex flex-col">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">{log.result}</span>
                              <span className="text-[10px] font-mono opacity-60 italic">{log.timestamp}</span>
                            </div>
                         </div>
                       ))}
                     </div>
                   </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          
          {/* Action Footer for Table */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-center sticky bottom-0 z-10 shrink-0">
            <button 
              onClick={exportInventory}
              className="px-10 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-3 text-sm ring-4 ring-white"
            >
              <Download size={20} /> Reconciliar & Exportar Archivo Final
            </button>
          </div>
        </main>
      </div>

      {/* Footer Info Bar */}
      <footer className="bg-slate-900 text-slate-400 px-4 sm:px-6 py-3 sm:py-2.5 flex flex-col sm:flex-row justify-between items-center text-[10px] font-mono shrink-0 gap-2">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
          <span>ITEMS: {inventory.length}</span>
          <span>CITY: {selectedCity || 'None'}</span>
          <span className="hidden xs:inline">PENDING: {inventory.filter(i => i.status === 'pending').length}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_#6366f1]"></div>
          <span className="text-slate-100 font-bold uppercase tracking-widest hidden xs:inline">System Operational</span>
          <span className="text-slate-100 font-bold uppercase tracking-widest inline xs:hidden">READY</span>
        </div>
      </footer>
    </div>
  );
}
