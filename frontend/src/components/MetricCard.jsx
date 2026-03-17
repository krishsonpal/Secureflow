import React from 'react';
import { Card, CardContent } from './ui/card.jsx';

const MetricCard = ({ title, value, icon, trend, trendUp }) => {
  return (
    <Card className="flex flex-col justify-between hover:bg-gray-800/50 transition-colors">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-400">{title}</p>
            <h4 className="mt-2 text-3xl font-bold tracking-tight text-gray-50">
              {value}
            </h4>
          </div>
          <div className={`rounded-xl p-3 ${
            title.includes('Blocked') ? 'bg-red-500/10 text-red-500' :
            title.includes('Rate Limits') ? 'bg-yellow-500/10 text-yellow-500' :
            'bg-blue-500/10 text-blue-500'
          }`}>
            {icon}
          </div>
        </div>
        <div className="mt-4 flex items-center text-xs">
          <span className={`font-semibold overflow-hidden flex items-center ${trendUp ? 'text-green-500' : 'text-red-500'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </span>
          <span className="ml-2 text-gray-500">vs last hour</span>
        </div>
      </CardContent>
    </Card>
  );
};

export default MetricCard;
