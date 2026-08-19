import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ImageFile } from '../types';
import ImagePreviewCard from './ImagePreviewCard';
import { UploadIcon, DownloadIcon, TagIcon, SpinnerIcon, ChevronLeftIcon, BroomIcon } from './Icons';
import { generateId } from '../utils/id';

interface ImageRenamerProps {
    onBack: () => void;
}

const ImageRenamer: React.FC<ImageRenamerProps> = ({ onBack }) => {
    const [imageFiles, setImageFiles] = useState<ImageFile[]>([]);
    const [isDownloading, setIsDownloading] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const resetTimeoutRef = useRef<number | null>(null);


    const getFileNameWithoutExtension = (filename: string): string => {
        return filename.substring(0, filename.lastIndexOf('.')) || filename;
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        const newImageFiles: ImageFile[] = Array.from(files).map((file: File) => ({
            id: generateId(),
            file: file,
            previewUrl: URL.createObjectURL(file),
            newName: getFileNameWithoutExtension(file.name),
        }));

        setImageFiles(prevFiles => [...prevFiles, ...newImageFiles]);

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const handleNameChange = useCallback((id: string, newName: string) => {
        setImageFiles(prevFiles =>
            prevFiles.map(file =>
                file.id === id ? { ...file, newName: newName } : file
            )
        );
    }, []);
    
    const handleRemoveImage = useCallback((id: string) => {
        setImageFiles(prevFiles => {
            const fileToRemove = prevFiles.find(f => f.id === id);
            if (fileToRemove) {
                URL.revokeObjectURL(fileToRemove.previewUrl);
            }
            return prevFiles.filter(file => file.id !== id);
        });
    }, []);

    const handleBulkRename = () => {
        if (imageFiles.length === 0) return;

        const renamedFiles = imageFiles.map((file, index) => ({
            ...file,
            newName: `sku${String(index + 1).padStart(3, '0')}`
        }));

        setImageFiles(renamedFiles);
    };

    const handleDownloadAll = async () => {
        if (imageFiles.length === 0 || isDownloading) return;

        setIsDownloading(true);

        try {
            for (const imageFile of imageFiles) {
                const extension = imageFile.file.name.split('.').pop();
                const finalName = imageFile.newName.trim() || getFileNameWithoutExtension(imageFile.file.name);
                const newFilename = `${finalName}.${extension}`;

                // Create a new object URL for downloading to ensure the original file is used.
                const downloadUrl = URL.createObjectURL(imageFile.file);
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = newFilename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Revoke the temporary URL to free up memory.
                URL.revokeObjectURL(downloadUrl);
                
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch (error) {
            console.error("Error downloading files:", error);
            alert("파일을 다운로드하는 중 오류가 발생했습니다.");
        } finally {
            setIsDownloading(false);
        }
    };

    const handleResetImages = useCallback(() => {
        if (confirmReset) {
            imageFiles.forEach(file => URL.revokeObjectURL(file.previewUrl));
            setImageFiles([]);
            setConfirmReset(false);
            if (resetTimeoutRef.current) {
                clearTimeout(resetTimeoutRef.current);
                resetTimeoutRef.current = null;
            }
        } else {
            setConfirmReset(true);
            resetTimeoutRef.current = window.setTimeout(() => {
                setConfirmReset(false);
                resetTimeoutRef.current = null;
            }, 3000);
        }
    }, [confirmReset, imageFiles]);

    useEffect(() => {
        return () => {
            imageFiles.forEach(file => URL.revokeObjectURL(file.previewUrl));
            if (resetTimeoutRef.current) {
                clearTimeout(resetTimeoutRef.current);
            }
        };
    }, [imageFiles]);

    const hasImages = imageFiles.length > 0;

    return (
        <div className="w-full max-w-7xl mx-auto">
            <header className="text-center mb-8 relative">
                 <button 
                    onClick={onBack} 
                    className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors py-2 px-3 rounded-lg hover:bg-slate-700"
                 >
                    <ChevronLeftIcon />
                    상품 목록으로 돌아가기
                 </button>
                <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                    옵션명 생성
                </h1>
                <p className="mt-2 text-lg text-slate-400">
                    여러 이미지를 업로드하고, 새 이름을 지정한 뒤 한 번에 다운로드하세요.
                </p>
            </header>

            <main>
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-white">시작하기</h2>
                        <p className="text-slate-400">이미지를 선택하거나, 일괄로 파일명을 지정하세요.</p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <input
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handleFileChange}
                            className="hidden"
                            ref={fileInputRef}
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-200"
                        >
                            <UploadIcon />
                            이미지 선택
                        </button>
                         <button
                            onClick={handleBulkRename}
                            disabled={!hasImages}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-sky-600 text-white font-semibold rounded-lg shadow-md hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-200 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed"
                        >
                            <TagIcon />
                            일괄 파일명 지정
                        </button>
                        <button
                            onClick={handleResetImages}
                            disabled={!hasImages}
                            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 text-white font-semibold rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-200 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed ${
                                confirmReset 
                                ? 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500' 
                                : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                            }`}
                        >
                            <BroomIcon />
                            {confirmReset ? '확인' : '초기화'}
                        </button>
                    </div>
                </div>

                {hasImages ? (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {imageFiles.map(file => (
                                <ImagePreviewCard
                                    key={file.id}
                                    imageFile={file}
                                    onNameChange={handleNameChange}
                                    onRemove={handleRemoveImage}
                                />
                            ))}
                        </div>
                        <div className="mt-8 flex justify-center">
                            <button
                                onClick={handleDownloadAll}
                                disabled={!hasImages || isDownloading}
                                className="flex items-center justify-center gap-3 px-12 py-4 bg-emerald-600 text-white text-lg font-bold rounded-lg shadow-lg hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-transform duration-200 hover:scale-105 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed"
                            >
                                {isDownloading ? (
                                    <>
                                        <SpinnerIcon className="w-6 h-6 animate-spin" />
                                        다운로드 중...
                                    </>
                                ) : (
                                    <>
                                        <DownloadIcon />
                                        전체 다운로드
                                    </>
                                )}
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="text-center py-20 bg-slate-800/50 border-2 border-dashed border-slate-700 rounded-xl">
                        <UploadIcon className="mx-auto h-12 w-12 text-slate-500" />
                        <h3 className="mt-2 text-xl font-semibold text-white">이미지가 없습니다</h3>
                        <p className="mt-1 text-slate-400">'이미지 선택' 버튼을 눌러 시작하세요.</p>
                    </div>
                )}
            </main>
        </div>
    );
};

export default ImageRenamer;