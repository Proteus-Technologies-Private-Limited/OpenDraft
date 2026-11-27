import {
  FaBookmark, FaClipboardList, FaCodeBranch, FaCommentDots, FaCut, FaFilm, FaHeart, FaLightbulb,
  FaLink, FaPause, FaPenNib, FaQuestionCircle, FaRegCheckSquare, FaSearch, FaSeedling, FaTag,
} from 'react-icons/fa';
import type { IconType } from 'react-icons';
import type { TaskIcon } from '../model';

const ICONS: Record<TaskIcon, IconType> = {
  todo: FaRegCheckSquare,
  rewrite: FaPenNib,
  dialogue: FaCommentDots,
  continuity: FaLink,
  research: FaSearch,
  trim: FaCut,
  feedback: FaClipboardList,
  question: FaQuestionCircle,
  setup: FaSeedling,
  production: FaFilm,
  hold: FaPause,
  darling: FaHeart,
  alternate: FaCodeBranch,
  idea: FaLightbulb,
  reference: FaBookmark,
  custom: FaTag,
};

export function TypeIcon({ icon }: { icon: TaskIcon }) {
  const Icon = ICONS[icon] ?? FaTag;
  return <Icon aria-hidden />;
}
