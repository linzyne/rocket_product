import React from 'react';
import { ImageFile } from '../types';
import { TrashIcon } from './Icons';

interface ImagePreviewCardProps {
    imageFile: ImageFile;
    onNameChange: (id: string, newName: string) => void;
    onRemove: (id: string) => void;
}

const ImagePreviewCard: React.FC<ImagePreviewCardProps> = ({ imageFile, onNameChange, onRemove }) => {
    const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
        event.target.select();
    };

    return (
        <div className="bg-slate-800 rounded-lg overflow-hidden shadow-lg transform transition-all duration-300 hover:scale-105 hover:shadow-purple-500/20">
            <div className="relative aspect-square">
                <img src={imageFile.previewUrl} alt={imageFile.file.name} className="w-full h-full object-cover" />
                <button
                    onClick={() => onRemove(imageFile.id)}
                    className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1.5 hover:bg-red-500 transition-colors"
                    aria-label="Remove image"
                >
                    <TrashIcon />
                </button>
            </div>
            <div className="p-3">
                <label htmlFor={`name-${imageFile.id}`} className="sr-only">New filename</label>
                <input
                    id={`name-${imageFile.id}`}
                    type="text"
                    value={imageFile.newName}
                    onChange={(e) => onNameChange(imageFile.id, e.target.value)}
                    onFocus={handleFocus}
                    className="w-full bg-slate-700 border border-slate-600 rounded-md text-sm text-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="Enter new name"
                />
                <p className="text-xs text-slate-400 mt-1 truncate" title={imageFile.file.name}>
                    Original: {imageFile.file.name}
                </p>
            </div>
        </div>
    );
};

export default React.memo(ImagePreviewCard);