import { useState } from 'react';
import { ChevronRight, ChevronDown, AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TreeNode } from '@/utils/tree-navigation';
import { Card } from '@/components/ui/card';

interface FleetTreeNavigatorProps {
  tree: TreeNode[];
  selectedNode: TreeNode | null;
  onNodeSelect: (node: TreeNode) => void;
}

function getHealthIcon(node: TreeNode) {
  if (node.criticalCount > 0) {
    return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  }
  if (node.warningCount > 0) {
    return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
  }
  return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
}

function getHealthBadge(node: TreeNode) {
  if (node.criticalCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
        🔴 {node.criticalCount}
      </span>
    );
  }
  if (node.warningCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
        🟡 {node.warningCount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
      ✓
    </span>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  level: number;
  selectedNode: TreeNode | null;
  onNodeSelect: (node: TreeNode) => void;
  expandedNodes: Set<string>;
  onToggleExpand: (nodeId: string) => void;
}

function TreeNodeItem({
  node,
  level,
  selectedNode,
  onNodeSelect,
  expandedNodes,
  onToggleExpand,
}: TreeNodeItemProps) {
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedNode?.id === node.id;
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      {/* Node */}
      <div
        className={cn(
          'flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors text-sm',
          isSelected && 'bg-primary/10 text-primary font-medium',
          !isSelected && 'hover:bg-muted'
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onNodeSelect(node)}
      >
        {/* Expand/collapse icon */}
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            className="flex-shrink-0 hover:bg-muted-foreground/10 rounded p-0.5"
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* Health icon */}
        {!hasChildren && <div className="w-3.5">{getHealthIcon(node)}</div>}

        {/* Label */}
        <span className="flex-1 truncate">{node.label}</span>

        {/* Badge */}
        {hasChildren && getHealthBadge(node)}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              level={level + 1}
              selectedNode={selectedNode}
              onNodeSelect={onNodeSelect}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
            />
          ))}
          {/* Show "X more" if region has more databases */}
          {node.type === 'region' && node.children!.length === 5 && (
            <div
              className="text-xs text-muted-foreground py-1 px-2"
              style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}
            >
              + {node.healthyCount + node.warningCount + node.criticalCount - 5} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FleetTreeNavigator({ tree, selectedNode, onNodeSelect }: FleetTreeNavigatorProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    // Auto-expand clouds with critical issues
    const initialExpanded = new Set<string>();
    tree.forEach((cloudNode) => {
      if (cloudNode.criticalCount > 0) {
        initialExpanded.add(cloudNode.id);
      }
    });
    return initialExpanded;
  });

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  return (
    <Card className="p-4 h-full overflow-y-auto">
      <div className="mb-4">
        <h3 className="font-semibold text-sm">Fleet Navigator</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Browse databases by cloud and region
        </p>
      </div>

      <div className="space-y-0.5">
        {tree.map((node) => (
          <TreeNodeItem
            key={node.id}
            node={node}
            level={0}
            selectedNode={selectedNode}
            onNodeSelect={onNodeSelect}
            expandedNodes={expandedNodes}
            onToggleExpand={toggleExpand}
          />
        ))}
      </div>
    </Card>
  );
}
