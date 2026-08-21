
import React, { useState } from 'react';
import { CloseIcon, TrashIcon, UploadIcon } from './Icons';
import { QuoteTemplateRegistration, OPTION_FIELD_COLOR } from '../data/quoteTemplates';
import { CATEGORY_PRESETS } from '../data/categoryPresets';

interface QuoteTemplateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  registrations: QuoteTemplateRegistration[];
  onAdd: (category: string, file: File, customFieldNames: string[], optionFieldName: string) => void;
  onDelete: (id: string) => void;
  onCleanupDuplicates: () => void;
  onUpdateCustomFieldNames: (id: string, customFieldNames: string[]) => void;
  onUpdateOptionFieldName: (id: string, optionFieldName: string) => void;
  onSetExposureBaseTemplate: (id: string) => void;
  categories: string[];
  onDeleteCategory: (category: string) => void;
}

const QuoteTemplateManagerModal: React.FC<QuoteTemplateManagerModalProps> = ({
  isOpen,
  onClose,
  registrations,
  onAdd,
  onDelete,
  onCleanupDuplicates,
  onUpdateCustomFieldNames,
  onUpdateOptionFieldName,
  onSetExposureBaseTemplate,
  categories,
  onDeleteCategory,
}) => {
  const [category, setCategory] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldNames, setFieldNames] = useState<string[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [optionFieldName, setOptionFieldName] = useState<string>(OPTION_FIELD_COLOR);

  if (!isOpen) return null;

  const handleAddFieldName = () => {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    if (fieldNames.includes(trimmed)) {
      setError('이미 추가한 항목 이름입니다.');
      return;
    }
    setFieldNames(prev => [...prev, trimmed]);
    setNewFieldName('');
  };

  const handleRemoveFieldName = (name: string) => {
    setFieldNames(prev => prev.filter(n => n !== name));
    setOptionFieldName(prev => (prev === name ? OPTION_FIELD_COLOR : prev));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const allowedExtensions = ['.xlsx', '.xls'];
    const fileName = selectedFile.name.toLowerCase();
    const fileExtension = fileName.substring(fileName.lastIndexOf('.'));

    if (!allowedExtensions.includes(fileExtension)) {
      setError('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.');
      setFile(null);
      return;
    }

    setError(null);
    setFile(selectedFile);
  };

  const handleRegister = () => {
    if (!category.trim()) {
      setError('카테고리를 입력해주세요.');
      return;
    }
    if (!file) {
      setError('견적서 엑셀 파일을 선택해주세요.');
      return;
    }

    onAdd(category.trim(), file, fieldNames, optionFieldName);
    setCategory('');
    setFile(null);
    setFieldNames([]);
    setNewFieldName('');
    setOptionFieldName(OPTION_FIELD_COLOR);
    setError(null);
  };

  const handleDeleteCategoryClick = (name: string) => {
    if (window.confirm(`'${name}' 카테고리를 목록에서 삭제하시겠습니까?\n(이미 등록된 견적서와 상품에 저장된 카테고리 값은 그대로 유지됩니다.)`)) {
      onDeleteCategory(name);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
          <CloseIcon />
        </button>
        <h2 className="text-2xl font-bold text-slate-100 mb-2">견적서 등록</h2>
        <p className="text-sm text-slate-400 mb-6">견적서 엑셀 양식을 카테고리와 함께 등록해두면, 상품마다 원하는 견적서를 선택해 개별 생성할 수 있습니다.</p>

        <div className="overflow-y-auto pr-1 flex-grow min-h-0">
        <div className="space-y-4 pb-6 border-b border-slate-700">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">카테고리</label>
            <input
              type="text"
              list="quote-template-category-presets"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="예: 어린이RC자동차/버스"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            />
            <datalist id="quote-template-category-presets">
              {categories.map(c => (
                <option key={c} value={c} />
              ))}
              {Object.entries(CATEGORY_PRESETS).map(([name, fullPath]) => (
                <option key={name} value={fullPath}>{name}</option>
              ))}
            </datalist>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">견적서 엑셀 파일</label>
            <label
              htmlFor="quote-template-file-upload"
              className="flex items-center gap-2 w-full px-3 py-2 bg-slate-700 border border-dashed border-slate-600 rounded-md text-sm text-slate-300 hover:border-slate-500 cursor-pointer transition-colors"
            >
              <UploadIcon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{file ? file.name : '파일 선택 (XLSX, XLS)'}</span>
            </label>
            <input id="quote-template-file-upload" type="file" className="sr-only" accept=".xlsx, .xls" onChange={handleFileChange} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">추가 항목 이름 (선택)</label>
            <p className="text-xs text-slate-500 mb-2">값이 아니라 항목 이름만 등록합니다. 상품등록에서 이 견적서를 선택하면 이름들이 상품의 추가 항목으로 자동 생성되고, 값은 상품마다 직접 입력합니다.</p>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={newFieldName}
                onChange={e => setNewFieldName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddFieldName(); } }}
                placeholder="예: 높이"
                className="flex-1 min-w-0 px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
              />
              <button
                type="button"
                onClick={handleAddFieldName}
                className="px-3 py-2 bg-slate-600 text-slate-200 text-sm font-semibold rounded-md hover:bg-slate-500 transition-colors flex-shrink-0"
              >
                추가
              </button>
            </div>
            {fieldNames.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {fieldNames.map(name => (
                  <span key={name} className="inline-flex items-center gap-1 bg-slate-700/60 border border-slate-600 rounded-full pl-3 pr-1.5 py-1 text-xs text-slate-200">
                    <span className="truncate max-w-[160px]">{name}</span>
                    <button
                      onClick={() => handleRemoveFieldName(name)}
                      className="flex-shrink-0 text-slate-400 hover:text-red-400 transition-colors leading-none w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-500/10"
                      aria-label={`Remove field name ${name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">노출속성 항목</label>
            <p className="text-xs text-slate-500 mb-2">1688에서 옵션(색상/사이즈 등)을 여러 개 붙여넣을 때, 옵션값을 채워 넣을 항목입니다.</p>
            <select
              value={optionFieldName}
              onChange={e => setOptionFieldName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
            >
              <option value={OPTION_FIELD_COLOR}>색상</option>
              {fieldNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-300 bg-red-900/30 p-3 rounded-md">{error}</p>}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleRegister}
              className="px-4 py-2 bg-purple-500 text-white font-semibold rounded-lg shadow-md hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all duration-200"
            >
              등록
            </button>
          </div>
        </div>

        <div className="pt-4 pb-6 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-1">등록된 카테고리 ({categories.length})</h3>
          <p className="text-xs text-slate-500 mb-2">여기서 직접 삭제하기 전까지는 견적서를 삭제해도 카테고리가 사라지지 않습니다.</p>
          {categories.length === 0 ? (
            <p className="text-sm text-slate-500">아직 등록된 카테고리가 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {categories.map(c => (
                <span key={c} className="inline-flex items-center gap-1 bg-slate-700/60 border border-slate-600 rounded-full pl-3 pr-1.5 py-1 text-xs text-slate-200">
                  <span className="truncate max-w-[220px]">{c}</span>
                  <button
                    onClick={() => handleDeleteCategoryClick(c)}
                    className="flex-shrink-0 text-slate-400 hover:text-red-400 transition-colors leading-none w-4 h-4 flex items-center justify-center rounded-full hover:bg-red-500/10"
                    aria-label={`Delete category ${c}`}
                    title="카테고리 삭제"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-300">등록된 견적서 ({registrations.length})</h3>
            {registrations.length > 1 && (
              <button
                type="button"
                onClick={onCleanupDuplicates}
                className="text-xs px-2.5 py-1 bg-slate-700 text-slate-300 border border-slate-600 rounded-md hover:bg-slate-600 hover:text-slate-100 transition-colors flex-shrink-0"
                title="카테고리별로 가장 최근에 등록한 견적서 1개만 남기고 나머지를 삭제합니다."
              >
                중복 정리
              </button>
            )}
          </div>
          {registrations.length === 0 ? (
            <p className="text-sm text-slate-500">아직 등록된 견적서가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {registrations.map(r => (
                <RegistrationListItem
                  key={r.id}
                  registration={r}
                  onDelete={onDelete}
                  onUpdateCustomFieldNames={onUpdateCustomFieldNames}
                  onUpdateOptionFieldName={onUpdateOptionFieldName}
                  onSetExposureBaseTemplate={onSetExposureBaseTemplate}
                />
              ))}
            </ul>
          )}
        </div>
        </div>

        <div className="mt-6 pt-5 border-t border-slate-700 flex justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

interface RegistrationListItemProps {
  registration: QuoteTemplateRegistration;
  onDelete: (id: string) => void;
  onUpdateCustomFieldNames: (id: string, customFieldNames: string[]) => void;
  onUpdateOptionFieldName: (id: string, optionFieldName: string) => void;
  onSetExposureBaseTemplate: (id: string) => void;
}

const RegistrationListItem: React.FC<RegistrationListItemProps> = ({ registration, onDelete, onUpdateCustomFieldNames, onUpdateOptionFieldName, onSetExposureBaseTemplate }) => {
  const [newName, setNewName] = useState('');
  const fieldNames = registration.customFieldNames || [];
  const optionFieldName = registration.optionFieldName || OPTION_FIELD_COLOR;

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed || fieldNames.includes(trimmed)) return;
    onUpdateCustomFieldNames(registration.id, [...fieldNames, trimmed]);
    setNewName('');
  };

  const handleRemove = (name: string) => {
    onUpdateCustomFieldNames(registration.id, fieldNames.filter(n => n !== name));
    if (optionFieldName === name) onUpdateOptionFieldName(registration.id, OPTION_FIELD_COLOR);
  };

  return (
    <li className="bg-slate-700/50 border border-slate-600 rounded-md px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium text-slate-200 truncate">{registration.category}</p>
            {registration.isExposureBaseTemplate && (
              <span className="flex-shrink-0 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
                노출속성 기본 양식
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 truncate">{registration.fileName}</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!registration.isExposureBaseTemplate && (
            <button
              onClick={() => onSetExposureBaseTemplate(registration.id)}
              className="text-xs px-2 py-1 bg-slate-700 text-slate-300 border border-slate-600 rounded-md hover:bg-slate-600 hover:text-slate-100 transition-colors whitespace-nowrap"
              title="이 견적서의 노출속성 항목을 기본값으로 삼아, 다른 견적서를 새로 등록할 때 여기 없는 항목만 자동으로 추가합니다."
            >
              기본 양식으로 지정
            </button>
          )}
          <button
            onClick={() => onDelete(registration.id)}
            className="text-slate-400 hover:text-red-500 transition-colors duration-200 p-1.5 rounded-md hover:bg-red-500/10"
            aria-label="Delete quote template"
            title="삭제"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className="mt-2 pt-2 border-t border-slate-600/60">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">추가 항목 이름</p>
        {fieldNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {fieldNames.map(name => (
              <span key={name} className="inline-flex items-center gap-1 bg-slate-600/60 border border-slate-500 rounded-full pl-2.5 pr-1 py-0.5 text-xs text-slate-200">
                <span className="truncate max-w-[140px]">{name}</span>
                <button
                  onClick={() => handleRemove(name)}
                  className="flex-shrink-0 text-slate-400 hover:text-red-400 transition-colors leading-none w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-red-500/10"
                  aria-label={`Remove field name ${name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
            placeholder="항목 이름 추가"
            className="flex-1 min-w-0 px-2 py-1 bg-slate-700 border border-slate-600 rounded-md text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
          />
          <button
            onClick={handleAdd}
            className="px-2.5 py-1 bg-slate-600 text-slate-200 text-xs font-semibold rounded-md hover:bg-slate-500 transition-colors flex-shrink-0"
          >
            추가
          </button>
        </div>

        <div className="mt-2 pt-2 border-t border-slate-600/60">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">노출속성 항목</p>
          <select
            value={optionFieldName}
            onChange={e => onUpdateOptionFieldName(registration.id, e.target.value)}
            className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded-md text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200"
          >
            <option value={OPTION_FIELD_COLOR}>색상</option>
            {fieldNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
      </div>
    </li>
  );
};

export default QuoteTemplateManagerModal;
